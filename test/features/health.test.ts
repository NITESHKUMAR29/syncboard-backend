import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

describe('GET /api/v1/health', () => {
  it('reports UP with the database UP', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health' });
    const body = response.json<{ status: string; database: string; version: string }>();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'UP', database: 'UP', version: body.version });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('needs no authentication', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).not.toBe(401);
  });
});
