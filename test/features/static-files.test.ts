import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/database.js';
import { testEnv } from '../helpers/env.js';
import { registerUser } from '../helpers/factories.js';
import { pngBytes } from '../helpers/fixtures-binary.js';

/**
 * Serving locally stored uploads (A9).
 *
 * Unlike the other upload tests, this one uses the real local storage driver rather than
 * the in-memory fake: the point is that a URL the API hands out actually resolves to the
 * file. That was missing once, and every avatar link 404'd.
 */

let database: TestDatabase;
let app: FastifyInstance;
let uploadDir: string;

beforeAll(async () => {
  database = await createTestDatabase();
  uploadDir = await mkdtemp(join(tmpdir(), 'taskflow-uploads-'));

  app = await buildApp({
    env: testEnv({ STORAGE_LOCAL_DIR: uploadDir, PUBLIC_BASE_URL: 'http://localhost:8080' }),
    prisma: database.prisma,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await database.close();
  await rm(uploadDir, { recursive: true, force: true });
});

function multipart(fileName: string, content: Buffer, contentType: string) {
  const boundary = '----TaskFlowTestBoundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );

  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('GET /files/{key}', () => {
  it('serves the file at the URL the upload returned', async () => {
    const user = await registerUser(app);
    const body = multipart('me.png', pngBytes(), 'image/png');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...user.auth, ...body.headers },
      payload: body.payload,
    });

    expect(upload.statusCode).toBe(200);
    const avatarUrl = upload.json<{ avatarUrl: string }>().avatarUrl;

    // Follow the URL the client was given, exactly as an image tag would.
    const fetched = await app.inject({ method: 'GET', url: new URL(avatarUrl).pathname });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/png');
    expect(fetched.rawPayload.equals(pngBytes())).toBe(true);
  });

  it('serves it without authentication, since the key is the secret', async () => {
    const user = await registerUser(app);
    const body = multipart('me.png', pngBytes(), 'image/png');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...user.auth, ...body.headers },
      payload: body.payload,
    });
    const avatarUrl = upload.json<{ avatarUrl: string }>().avatarUrl;

    // No Authorization header: an <img> tag cannot send one.
    const fetched = await app.inject({ method: 'GET', url: new URL(avatarUrl).pathname });

    expect(fetched.statusCode).toBe(200);
  });

  it('marks files no-sniff, so a browser cannot be tricked into running one', async () => {
    const user = await registerUser(app);
    const body = multipart('me.png', pngBytes(), 'image/png');

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...user.auth, ...body.headers },
      payload: body.payload,
    });

    const fetched = await app.inject({
      method: 'GET',
      url: new URL(upload.json<{ avatarUrl: string }>().avatarUrl).pathname,
    });

    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect(fetched.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('returns 404 for a key that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/files/avatars/${randomUUID()}/missing.png`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('refuses to walk out of the storage directory', async () => {
    for (const url of ['/files/../.env', '/files/../../etc/passwd', '/files/..%2f.env']) {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});
