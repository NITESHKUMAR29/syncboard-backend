import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app.js';
import type { Database } from '../../src/plugins/prisma.js';
import { createTestDatabase } from './database.js';
import { testEnv } from './env.js';

export interface TestApp {
  app: FastifyInstance;
  prisma: Database;
  close(): Promise<void>;
}

/** Builds the app against a fresh throwaway database. */
export async function buildTestApp(deps: Omit<AppDeps, 'env' | 'prisma'> = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const app = await buildApp({ ...deps, env: testEnv(), prisma: database.prisma });
  await app.ready();

  return {
    app,
    prisma: database.prisma,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

/**
 * Builds the app with a stub database, for tests about HTTP behavior (error bodies,
 * headers, routing) that never read a row.
 */
export async function buildAppWithStubDatabase(
  stub: Partial<Database> = {},
  envOverrides: Partial<Parameters<typeof testEnv>[0]> = {},
): Promise<FastifyInstance> {
  const database = {
    $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
    $disconnect: () => Promise.resolve(),
    ...stub,
  } as unknown as Database;

  const app = await buildApp({ env: testEnv(envOverrides), prisma: database });
  await app.ready();
  return app;
}
