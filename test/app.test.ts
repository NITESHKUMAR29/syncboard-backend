import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAppWithStubDatabase } from './helpers/app.js';

/**
 * App-level contract: the conventions in Part B §4 that every endpoint inherits.
 * These use a stub database, so they need no Docker.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('request ids', () => {
  it('returns X-Request-Id on every response', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('echoes a client-supplied request id so logs can be correlated end to end', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'android-trace-42' },
    });

    expect(response.headers['x-request-id']).toBe('android-trace-42');
  });
});

describe('not found handler', () => {
  it('returns the standard error body for an unknown route', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('returns the standard error body outside the API prefix too', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({ method: 'POST', url: '/wp-login.php' });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('health', () => {
  it('reports UP with a reachable database', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    const body = response.json<{ status: string; database: string; version: string }>();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'UP', database: 'UP', version: body.version });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('stays UP but reports the database DOWN when the query fails', async () => {
    app = await buildAppWithStubDatabase({
      $queryRaw: () => Promise.reject(new Error('connection refused')),
    } as never);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    // The process is alive and must keep answering; only `database` flips.
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toMatchObject({ status: 'UP', database: 'DOWN' });
  });

  it('is exempt from the rate limiter so uptime probes are never throttled', async () => {
    app = await buildAppWithStubDatabase();

    const responses = await Promise.all(
      Array.from({ length: 130 }, () => app!.inject({ method: 'GET', url: '/api/v1/health' })),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
  });
});

describe('security headers', () => {
  it('sends the helmet baseline', async () => {
    app = await buildAppWithStubDatabase();

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
