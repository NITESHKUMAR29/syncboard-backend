import type { Env } from '../../src/config/env.js';

/** A valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://taskflow:taskflow@127.0.0.1:5432/taskflow_test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    JWT_ISSUER: 'taskflow',
    JWT_AUDIENCE: 'taskflow-android',
    ACCESS_TOKEN_TTL_MINUTES: 15,
    REFRESH_TOKEN_TTL_DAYS: 30,
    STORAGE_LOCAL_DIR: './uploads',
    PUBLIC_BASE_URL: 'http://localhost:8080',
    CORS_ALLOWED_ORIGINS: '',
    ENABLE_SWAGGER_UI: false,
    ...overrides,
  };
}
