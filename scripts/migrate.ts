import { spawnSync } from 'node:child_process';
import { createDatabase, isEmbeddedUrl } from '../src/plugins/prisma.js';

/**
 * Applies migrations to whatever DATABASE_URL points at.
 *
 * An embedded PGlite database is migrated in this process by replaying the migration SQL;
 * a real PostgreSQL server is migrated by the Prisma CLI, which is what production uses.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file — the environment already carries the variables.
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set. Copy .env.example to .env first.\n');
  process.exit(1);
}

if (isEmbeddedUrl(databaseUrl)) {
  const database = createDatabase(databaseUrl);
  const applied = await database.applyMigrations();
  await database.close();

  process.stdout.write(
    applied.length === 0
      ? 'Database is already up to date.\n'
      : `Applied ${String(applied.length)} migration(s):\n${applied.map((name) => `  ${name}`).join('\n')}\n`,
  );
} else {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  process.exit(result.status ?? 1);
}
