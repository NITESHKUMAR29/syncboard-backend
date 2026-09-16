import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import type { Database } from '../../src/plugins/prisma.js';

/** Health against real PostgreSQL. */

let app: FastifyInstance;
let prisma: Database;

beforeAll(async () => {
  const started = await buildTestApp(inject('databaseUrl'));
  app = started.app;
  prisma = started.prisma;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/v1/health', () => {
  it('reports UP with the database UP', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    const body = response.json<{ status: string; database: string; version: string }>();

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'UP', database: 'UP', version: body.version });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('needs no authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).not.toBe(401);
  });
});
