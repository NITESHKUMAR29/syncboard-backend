import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app.js';
import { createPrismaClient, type Database } from '../../src/plugins/prisma.js';
import { testEnv } from './env.js';

/** Builds the app against a real database (Testcontainers URL from global setup). */
export async function buildTestApp(
  databaseUrl: string,
  deps: Omit<AppDeps, 'env' | 'prisma'> = {},
): Promise<{ app: FastifyInstance; prisma: Database }> {
  const prisma = createPrismaClient({ databaseUrl });
  const app = await buildApp({ ...deps, env: testEnv({ DATABASE_URL: databaseUrl }), prisma });
  await app.ready();
  return { app, prisma };
}

/**
 * Builds the app with a stub database, for tests about HTTP behavior (error bodies,
 * headers, routing) that never read a row.
 */
export async function buildAppWithStubDatabase(
  stub: Partial<Database> = {},
): Promise<FastifyInstance> {
  const database = {
    $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
    $disconnect: () => Promise.resolve(),
    ...stub,
  } as unknown as Database;

  const app = await buildApp({ env: testEnv(), prisma: database });
  await app.ready();
  return app;
}
