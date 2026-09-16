import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

/**
 * Starts one PostgreSQL 16 container for the whole run and applies every migration from
 * zero with `prisma migrate deploy` — which doubles as the migration test (Phase 0 exit
 * criteria). The URL reaches tests through `inject('databaseUrl')`.
 *
 * Requires Docker. Run `npm run test:no-db` for the suites that do not need it.
 */

const run = promisify(execFile);

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('taskflow_test')
    .withUsername('taskflow')
    .withPassword('taskflow')
    .start();

  const databaseUrl = container.getConnectionUri();

  await run('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: process.platform === 'win32',
  });

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
