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
  try {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('taskflow_test')
      .withUsername('taskflow')
      .withPassword('taskflow')
      .start();
  } catch (error) {
    throw new Error(noRuntimeMessage(error), { cause: error });
  }

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

/**
 * Testcontainers' own message ("Could not find a working container runtime strategy")
 * does not say what to do about it, and a managed database like Neon is not a substitute
 * here: these tests create and drop schema.
 */
function noRuntimeMessage(error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);

  if (!original.includes('container runtime')) {
    return `Could not start the test database: ${original}`;
  }

  return [
    'No container runtime found, so the integration tests cannot start PostgreSQL.',
    '',
    'Install one (any of these works, all are free):',
    '  colima:   brew install colima docker && colima start',
    '  orbstack: brew install orbstack',
    '  podman:   brew install podman && podman machine init && podman machine start',
    '',
    'Or run `npm run test:no-db` for the suites that need no database.',
  ].join('\n');
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
