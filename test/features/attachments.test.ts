import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { oversizedPng, pdfBytes, pngBytes, textBytes } from '../helpers/fixtures-binary.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Attachments and avatars (FR-ATT-1…2, FR-USER-2). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

/** Builds a multipart body by hand, the way an Android client would send one. */
function multipart(fileName: string, content: Buffer, contentType = 'application/octet-stream') {
  const boundary = '----TaskFlowTestBoundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup() {
  const fixture = await createWorkspaceFixture(app());
  const boardId = await createBoard(app(), fixture.id, fixture.owner);
  const task = await createTask(app(), boardId, fixture.owner);
  return { fixture, task };
}

describe('POST /tasks/{id}/attachments', () => {
  it('accepts a PNG from a MEMBER and returns the DTO (FR-ATT-1)', async () => {
    const { fixture, task } = await setup();
    const body = multipart('mockup.png', pngBytes(), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.member.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      taskId: task.id,
      fileName: 'mockup.png',
      mimeType: 'image/png',
    });
    // sizeBytes is a BIGINT column and must come back as a number, not a string.
    expect(typeof response.json<{ sizeBytes: unknown }>().sizeBytes).toBe('number');
  });

  it('accepts a PDF', async () => {
    const { fixture, task } = await setup();
    const body = multipart('spec.pdf', pdfBytes(), 'application/pdf');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ mimeType: string }>().mimeType).toBe('application/pdf');
  });

  it('rejects a disallowed type with 400 UNSUPPORTED_FILE_TYPE', async () => {
    const { fixture, task } = await setup();
    const body = multipart('notes.txt', textBytes(), 'text/plain');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('trusts the bytes, not the declared content type', async () => {
    const { fixture, task } = await setup();
    // A text file wearing an image/png label.
    const body = multipart('fake.png', textBytes(), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a file over 10 MB with 413 FILE_TOO_LARGE', async () => {
    const { fixture, task } = await setup();
    const body = multipart('huge.png', oversizedPng(11 * 1024 * 1024), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('FILE_TOO_LARGE');
  });

  it('increases the task attachmentCount', async () => {
    const { fixture, task } = await setup();
    const body = multipart('mockup.png', pngBytes(), 'image/png');

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    const detail = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    expect(detail.json<{ attachmentCount: number }>().attachmentCount).toBe(1);
  });

  it('returns 404 for a non-member', async () => {
    const { fixture, task } = await setup();
    const body = multipart('mockup.png', pngBytes(), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.outsider.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(404);
  });

  it('stores the file under an unguessable key', async () => {
    const { fixture, task } = await setup();
    const body = multipart('mockup.png', pngBytes(), 'image/png');

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attachments`,
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    // Other tests in this file share the storage, so find this upload's key.
    const key = [...testApp.storage.files.keys()].find((candidate) => candidate.includes(task.id));

    expect(key).toMatch(
      new RegExp(`^workspaces/${fixture.id}/tasks/${task.id}/[0-9a-f-]{36}-mockup\\.png$`),
    );
  });
});

describe('DELETE /attachments/{id}', () => {
  async function upload(headers: Record<string, string>, taskId: string) {
    const body = multipart('mockup.png', pngBytes(), 'image/png');
    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/attachments`,
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    });
    return response.json<{ id: string }>().id;
  }

  it('removes the row and the stored file (FR-ATT-2)', async () => {
    const { fixture, task } = await setup();
    const id = await upload(fixture.member.auth, task.id);

    expect(testApp.storage.files.size).toBeGreaterThan(0);
    const before = testApp.storage.files.size;

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(204);
    expect(testApp.storage.files.size).toBe(before - 1);
  });

  it('lets an ADMIN delete someone else’s', async () => {
    const { fixture, task } = await setup();
    const id = await upload(fixture.member.auth, task.id);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(204);
  });

  it('stops another MEMBER deleting it', async () => {
    const { fixture, task } = await setup();
    const id = await upload(fixture.owner.auth, task.id);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /users/me/avatar (FR-USER-2)', () => {
  it('stores an image and sets avatarUrl', async () => {
    const { fixture } = await setup();
    const body = multipart('me.png', pngBytes(), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...fixture.member.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ avatarUrl: string | null }>().avatarUrl).toMatch(
      /^https:\/\/files\.test\//,
    );

    const profile = await app().inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: fixture.member.auth,
    });
    expect(profile.json<{ avatarUrl: string | null }>().avatarUrl).not.toBeNull();
  });

  it('rejects a PDF, since avatars are images only', async () => {
    const { fixture } = await setup();
    const body = multipart('spec.pdf', pdfBytes(), 'application/pdf');

    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an image over 2 MB', async () => {
    const { fixture } = await setup();
    const body = multipart('big.png', oversizedPng(3 * 1024 * 1024), 'image/png');

    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: { ...fixture.owner.auth, ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(413);
  });
});
