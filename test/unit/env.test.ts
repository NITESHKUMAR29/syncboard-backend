import { describe, expect, it } from 'vitest';
import { corsOrigins, loadEnv } from '../../src/config/env.js';

const minimal = {
  DATABASE_URL: 'postgresql://taskflow:taskflow@localhost:5432/taskflow',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
};

describe('loadEnv', () => {
  it('applies the documented defaults', () => {
    const env = loadEnv(minimal);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8080);
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    // FR-AUTH-6: production must hash at cost 12 unless deliberately overridden.
    expect(env.BCRYPT_COST).toBe(12);
  });

  it('coerces numeric variables from their string form', () => {
    const env = loadEnv({ ...minimal, PORT: '3000', ACCESS_TOKEN_TTL_MINUTES: '5' });

    expect(env.PORT).toBe(3000);
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(5);
  });

  it('names the missing variable so startup failures are self-explaining', () => {
    expect(() => loadEnv({ JWT_SECRET: minimal.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects a JWT secret shorter than 32 characters (NFR-3)', () => {
    expect(() => loadEnv({ ...minimal, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...minimal, PORT: '70000' })).toThrow(/PORT/);
  });
});

describe('PUBLIC_BASE_URL', () => {
  it('defaults to localhost for development', () => {
    expect(loadEnv(minimal).PUBLIC_BASE_URL).toBe('http://localhost:8080');
  });

  it('takes the platform URL when no explicit value is given', () => {
    const env = loadEnv({ ...minimal, RENDER_EXTERNAL_URL: 'https://app.onrender.com' });

    expect(env.PUBLIC_BASE_URL).toBe('https://app.onrender.com');
  });

  it('prefers an explicit value over the platform one', () => {
    const env = loadEnv({
      ...minimal,
      PUBLIC_BASE_URL: 'https://api.example.com',
      RENDER_EXTERNAL_URL: 'https://app.onrender.com',
    });

    expect(env.PUBLIC_BASE_URL).toBe('https://api.example.com');
  });

  it('rejects an internal host:port, which would yield unopenable file URLs', () => {
    // The trap: new URL() reads "taskflow-backend-wzjw:" as a protocol and accepts this.
    expect(() =>
      loadEnv({ ...minimal, RENDER_EXTERNAL_URL: 'taskflow-backend-wzjw:10000' }),
    ).toThrow(/PUBLIC_BASE_URL/);
  });

  it('rejects a non-http scheme', () => {
    expect(() => loadEnv({ ...minimal, PUBLIC_BASE_URL: 'ftp://files.example.com' })).toThrow(
      /PUBLIC_BASE_URL/,
    );
  });
});

describe('corsOrigins', () => {
  it('is empty by default, which disables cross-origin requests', () => {
    expect(corsOrigins(loadEnv(minimal))).toEqual([]);
  });

  it('splits and trims a comma-separated list', () => {
    const env = loadEnv({ ...minimal, CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test ' });

    expect(corsOrigins(env)).toEqual(['http://a.test', 'http://b.test']);
  });
});
