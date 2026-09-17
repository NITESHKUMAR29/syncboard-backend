import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';

/**
 * Writes the generated OpenAPI document to openapi.yaml (Part A, npm run openapi:export).
 *
 * The app is built but never listens and never touches the database, so this runs in CI
 * without Postgres.
 */

const OUTPUT_PATH = resolve(process.cwd(), 'openapi.yaml');

const exportEnv: Env = {
  NODE_ENV: 'test',
  PORT: 8080,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:5432/openapi',
  JWT_SECRET: 'openapi-export-placeholder-secret-value-32',
  JWT_ISSUER: 'taskflow',
  JWT_AUDIENCE: 'taskflow-android',
  ACCESS_TOKEN_TTL_MINUTES: 15,
  REFRESH_TOKEN_TTL_DAYS: 30,
  STORAGE_LOCAL_DIR: './uploads',
  PUBLIC_BASE_URL: 'http://localhost:8080',
  CORS_ALLOWED_ORIGINS: '',
  ENABLE_SWAGGER_UI: false,
  RATE_LIMIT_ENABLED: false,
};

async function main(): Promise<void> {
  const app = await buildApp({ env: exportEnv });
  await app.ready();

  const document = app.swagger();
  await writeFile(OUTPUT_PATH, stringify(document), 'utf8');
  await app.close();

  process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
}

await main();
