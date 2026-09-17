import { mkdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Database wiring.
 *
 * Two drivers, one client. Prisma 7 connects through a driver adapter, which makes the
 * choice a matter of configuration:
 *
 *   postgresql://…   a real PostgreSQL server (Neon, Docker, anything) via node-postgres
 *   pglite://…       PostgreSQL compiled to WebAssembly, running inside this process
 *
 * PGlite is the same PostgreSQL engine, so the schema, migrations and queries are
 * identical; it just needs nothing installed. That makes it the default for local
 * development and for tests, where each file gets its own throwaway in-memory database.
 *
 * PGlite carries 25 MB of WebAssembly, so it is imported only when actually selected:
 * a deployed server talking to PostgreSQL should not pay to load a database it will
 * never use.
 *
 * Repositories are the only layer that touches the returned client (NFR-9).
 */

export type Database = PrismaClient;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

/** Tracks which migrations a PGlite database has already run. */
const MIGRATIONS_TABLE = '_taskflow_migrations';

export interface DatabaseHandle {
  prisma: Database;
  /** True when this is an in-process PGlite database rather than a PostgreSQL server. */
  readonly isEmbedded: boolean;
  /**
   * Applies every migration that has not run yet. Embedded databases only: against a real
   * server, `prisma migrate deploy` owns this.
   */
  applyMigrations(): Promise<string[]>;
  close(): Promise<void>;
}

export function isEmbeddedUrl(url: string): boolean {
  return url.startsWith('pglite:') || url.startsWith('file:');
}

/** Opens a database from a connection URL, choosing the driver from its scheme. */
export async function createDatabase(url: string): Promise<DatabaseHandle> {
  return isEmbeddedUrl(url) ? createEmbeddedDatabase(url) : createServerDatabase(url);
}

function createServerDatabase(connectionString: string): DatabaseHandle {
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    isEmbedded: false,
    applyMigrations() {
      return Promise.reject(
        new Error(
          'Migrations against a PostgreSQL server are applied with `npm run db:migrate`, which runs the Prisma CLI.',
        ),
      );
    },
    close: () => prisma.$disconnect(),
  };
}

async function createEmbeddedDatabase(url: string): Promise<DatabaseHandle> {
  // Loaded here rather than at module scope: see the note above.
  const [{ PGlite }, { PrismaPGlite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('pglite-prisma-adapter'),
  ]);

  const dataDir = toDataDir(url);

  // PGlite creates its data directory non-recursively, so a nested path like
  // ./data/taskflow fails unless the parent already exists.
  if (dataDir) {
    mkdirSync(dirname(resolve(dataDir)), { recursive: true });
  }

  const pglite = new PGlite(dataDir);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });

  return {
    prisma,
    isEmbedded: true,

    async applyMigrations() {
      await pglite.exec(
        `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );

      const applied = await pglite.query<{ name: string }>(
        `SELECT name FROM "${MIGRATIONS_TABLE}"`,
      );
      const done = new Set(applied.rows.map((row) => row.name));

      const pending = (await listMigrations()).filter((name) => !done.has(name));

      for (const name of pending) {
        const sql = await readFile(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
        // Each migration file is applied as one script, so a failure part-way leaves it
        // unrecorded and it will be retried rather than silently half-applied.
        await pglite.exec(sql);
        await pglite.query(`INSERT INTO "${MIGRATIONS_TABLE}" (name) VALUES ($1)`, [name]);
      }

      return pending;
    },

    async close() {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}

/** Migration directories in lexical order, which is chronological given the timestamps. */
async function listMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * `pglite://` and `file:` URLs name a directory to persist into. An empty path, or
 * `memory`, means keep it in RAM and lose it on exit — what tests want.
 */
function toDataDir(url: string): string | undefined {
  const path = url.replace(/^pglite:(\/\/)?/, '').replace(/^file:(\/\/)?/, '');

  if (path === '' || path === 'memory' || path === ':memory:') {
    return undefined;
  }

  return path;
}
