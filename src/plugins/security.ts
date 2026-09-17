import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { corsOrigins, type Env } from '../config/env.js';

/**
 * Security plugins (NFR-5).
 *
 * Rate limits from Part B §4: 120 requests per minute per user across the API. The
 * stricter 10-per-minute-per-IP limit for auth endpoints is applied on those routes in
 * Phase 1. The plugin throws an error carrying statusCode 429 and sets `Retry-After`
 * itself, so the standard error handler produces the RATE_LIMITED body.
 */

export const GLOBAL_RATE_LIMIT_MAX = 120;
export const AUTH_RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW = '1 minute';

export async function registerSecurity(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(helmet, {
    // Swagger UI needs inline styles and scripts; it is the only HTML this API serves.
    contentSecurityPolicy: env.ENABLE_SWAGGER_UI ? false : undefined,
  });

  const origins = corsOrigins(env);
  await app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  if (!env.RATE_LIMIT_ENABLED) {
    return;
  }

  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    // Per user once authenticated, per IP before that.
    keyGenerator: (request: FastifyRequest) => request.authUser?.userId ?? request.ip,
    // /health is polled by uptime checks and must never be throttled.
    allowList: (request: FastifyRequest) => request.url.startsWith('/api/v1/health'),
  });
}
