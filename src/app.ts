import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { systemClock, type Clock } from './common/clock.js';
import { loadEnv, type Env } from './config/env.js';
import { healthRoutes } from './features/health/health.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { createPrismaClient, type Database } from './plugins/prisma.js';
import { registerSecurity } from './plugins/security.js';
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
}

/**
 * Builds the Fastify app without listening on a port. server.ts owns the socket; tests
 * use app.inject().
 */
export async function buildApp(deps: AppDeps = {}): Promise<FastifyInstance> {
  const env = deps.env ?? loadEnv();
  const clock = deps.clock ?? systemClock;
  const version = deps.version ?? process.env.npm_package_version ?? '1.0.0';
  const prisma = deps.prisma ?? createPrismaClient({ databaseUrl: env.DATABASE_URL });
  const ownsPrisma = deps.prisma === undefined;

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

  registerErrorHandler(app);
  await registerSecurity(app, env);
  await registerSwagger(app, env);

  await app.register(
    async (instance) => {
      await instance.register(healthRoutes, { version });
    },
    { prefix: API_PREFIX },
  );

  if (ownsPrisma) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }

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
