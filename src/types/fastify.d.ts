import 'fastify';
import type { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import type { Database } from '../plugins/prisma.js';

/**
 * Shared decorations. `authUser` is populated by the auth hook in Phase 1; it is declared
 * here because the rate limiter already keys on it (Part B §4: 120 req/min per user).
 */
declare module 'fastify' {
  interface FastifyInstance {
    prisma: Database;
    clock: Clock;
    env: Env;
  }

  interface FastifyRequest {
    authUser?: { userId: string };
  }
}
