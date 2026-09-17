import { createDatabase, type Database } from '../../src/plugins/prisma.js';

/**
 * A throwaway database for one test file: real PostgreSQL through PGlite, in memory, with
 * every migration applied. No server and no container, and a fresh one per file, so tests
 * cannot interfere with each other and can run in parallel.
 */

export interface TestDatabase {
  prisma: Database;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const handle = await createDatabase('pglite://memory');
  await handle.applyMigrations();
  return handle;
}
