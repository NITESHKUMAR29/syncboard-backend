import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { systemClock, type Clock } from './common/clock.js';
import { loadEnv, type Env } from './config/env.js';
import { activityRoutes } from './features/activity/activity.routes.js';
import { attachmentRoutes } from './features/attachments/attachment.routes.js';
import { authRoutes } from './features/auth/auth.routes.js';
import { boardRoutes } from './features/boards/board.routes.js';
import { commentRoutes } from './features/comments/comment.routes.js';
import { deviceRoutes } from './features/devices/device.routes.js';
import { healthRoutes } from './features/health/health.routes.js';
import { createNoopBroadcaster, type EventBroadcaster } from './features/realtime/events.js';
import { registerRealtime } from './features/realtime/realtime.routes.js';
import { createSessionRegistry } from './features/realtime/session-registry.js';
import { syncRoutes } from './features/sync/sync.routes.js';
import { taskRoutes } from './features/tasks/task.routes.js';
import { userRoutes } from './features/users/user.routes.js';
import { workspaceRoutes } from './features/workspaces/workspace.routes.js';
import type { PushSender } from './push/push-sender.js';
import { createPushSender } from './push/create-push-sender.js';
import { createDueSoonJob } from './jobs/due-soon.js';
import { registerUploads } from './plugins/uploads.js';
import { createFileStorage } from './plugins/storage.js';
import type { FileStorage } from './storage/file-storage.js';
import { createAccessTokenIssuer, registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { createDatabase, type Database } from './plugins/prisma.js';
import { registerSecurity } from './plugins/security.js';
import { registerStaticFiles } from './plugins/static-files.js';
import { registerSwagger } from './plugins/swagger.js';

export const API_PREFIX = '/api/v1';

/** 1 MB JSON bodies (NFR-4); upload routes opt out via @fastify/multipart in Phase 4. */
const JSON_BODY_LIMIT_BYTES = 1_048_576;

/**
 * Dependencies buildApp accepts so tests can substitute fakes (NFR-10). Anything omitted
 * gets its production implementation.
 */
export interface AppDeps {
  env?: Env;
  clock?: Clock;
  prisma?: Database;
  version?: string;
  /** Swapped for a fake in tests that assert on emitted events. */
  events?: EventBroadcaster;
  /** Swapped for a fake in tests that assert on notifications. */
  push?: PushSender;
  /** Swapped for an in-memory implementation in tests. */
  storage?: FileStorage;
}

/**
 * Builds the Fastify app without listening on a port. server.ts owns the socket; tests
 * use app.inject().
 */
export async function buildApp(deps: AppDeps = {}): Promise<FastifyInstance> {
  const env = deps.env ?? loadEnv();
  const clock = deps.clock ?? systemClock;
  const version = deps.version ?? process.env.npm_package_version ?? '1.0.0';
  // When the caller supplies a client (tests), it owns its lifecycle; otherwise the app
  // opens one and closes it on shutdown.
  const database = deps.prisma ? undefined : await createDatabase(env.DATABASE_URL);
  const prisma = deps.prisma ?? database!.prisma;
  // The registry is both the broadcaster services call and the store the WebSocket
  // route registers connections in, so live events need no wiring beyond this.
  const registry = deps.events ? undefined : createSessionRegistry();
  const events = deps.events ?? registry ?? createNoopBroadcaster();
  const storage = deps.storage ?? (await createFileStorage(env));

  const app = Fastify({
    logger: buildLoggerOptions(env),
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    // Part B §4: every response carries X-Request-Id for debugging.
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : randomUUID();
    },
    requestIdHeader: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  // One schema, three uses: the same Zod schema validates, types and documents.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', env);
  app.decorate('clock', clock);
  app.decorate('prisma', prisma);

  app.addHook('onSend', async (request, reply) => {
    void reply.header('X-Request-Id', request.id);
  });

  // Push needs the logger, so it is built once Fastify exists. A test-supplied sender
  // wins; otherwise Firebase when credentials are set, and logged payloads when not.
  const push = deps.push ?? (await createPushSender(env, prisma, app.log));

  // The scheduler lives in this process (A9), so it belongs to the app's lifecycle.
  // Tests pass their own push sender and get no scheduler, since a timer that outlives
  // the test would keep the process alive.
  const dueSoon = deps.push
    ? undefined
    : createDueSoonJob({ db: prisma, push, clock, logger: app.log });

  registerErrorHandler(app);
  await registerSecurity(app, env);
  await registerAuth(app, env);
  await registerUploads(app);
  // Outside the /api/v1 prefix: stored URLs are /files/{key}.
  await registerStaticFiles(app, env);
  await registerSwagger(app, env);

  const accessTokens = createAccessTokenIssuer(app, env);

  await app.register(
    async (instance) => {
      if (registry) {
        await registerRealtime(instance, { registry });
      }

      await instance.register(healthRoutes, { version });
      await instance.register(authRoutes, { accessTokens });
      await instance.register(userRoutes);
      await instance.register(deviceRoutes);
      await instance.register(workspaceRoutes, { events, push });
      await instance.register(boardRoutes, { events });
      await instance.register(taskRoutes, { events, push });
      await instance.register(commentRoutes, { events, push });
      await instance.register(activityRoutes);
      await instance.register(attachmentRoutes, { storage });
      await instance.register(syncRoutes);
    },
    { prefix: API_PREFIX },
  );

  app.addHook('onClose', async () => {
    dueSoon?.stop();
    await database?.close();
  });

  return app;
}

/**
 * Structured JSON logs with request id, method, path, status and duration (NFR-8), and
 * redaction of anything that could leak a credential (NFR-3, FR-AUTH-6).
 */
function buildLoggerOptions(env: Env) {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.refreshToken',
        '*.accessToken',
        '*.token',
        '*.tokenHash',
        '*.fcmToken',
        'password',
        'passwordHash',
        'refreshToken',
        'accessToken',
        'fcmToken',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (request: { id: string; method: string; url: string; ip: string }) => ({
        requestId: request.id,
        method: request.method,
        path: request.url,
        ip: request.ip,
      }),
      res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
    },
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          }
        : undefined,
  };
}
