import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Comments (FR-CMT-1…3) and the activity feed (FR-ACT-1…2). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

async function setup() {
  const fixture = await createWorkspaceFixture(app());
  const boardId = await createBoard(app(), fixture.id, fixture.owner);
  const task = await createTask(app(), boardId, fixture.owner);
  return { fixture, boardId, task };
}

const addComment = (
  taskId: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
) => app().inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/comments`, headers, payload });

describe('POST /tasks/{id}/comments', () => {
  it('adds a comment as a MEMBER, unedited at version 1 (FR-CMT-1)', async () => {
    const { fixture, task } = await setup();

    const response = await addComment(task.id, fixture.member.auth, {
      body: 'Pushed the first draft',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      body: 'Pushed the first draft',
      edited: false,
      version: 1,
      author: { id: fixture.member.id },
    });
  });

  it('rejects an empty body and one over 5,000 characters', async () => {
    const { fixture, task } = await setup();

    const empty = await addComment(task.id, fixture.owner.auth, { body: '   ' });
    const huge = await addComment(task.id, fixture.owner.auth, { body: 'x'.repeat(5_001) });

    expect(empty.statusCode).toBe(400);
    expect(huge.statusCode).toBe(400);
  });

  it('returns 404 for a non-member', async () => {
    const { fixture, task } = await setup();

    const response = await addComment(task.id, fixture.outsider.auth, { body: 'Sneaky' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 200 and creates nothing on a repeated client id (FR-CMT-1)', async () => {
    const { fixture, task } = await setup();
    const clientId = randomUUID();

    const first = await addComment(task.id, fixture.member.auth, {
      id: clientId,
      body: 'Sent once',
    });
    const retry = await addComment(task.id, fixture.member.auth, {
      id: clientId,
      body: 'Sent once',
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);

    const list = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.member.auth,
    });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('rejects a client id belonging to someone else', async () => {
    const { fixture, task } = await setup();
    const clientId = randomUUID();

    await addComment(task.id, fixture.owner.auth, { id: clientId, body: 'Mine' });
    const response = await addComment(task.id, fixture.member.auth, {
      id: clientId,
      body: 'Yours',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({
      id: 'ID_TAKEN',
    });
  });
});

describe('GET /tasks/{id}/comments', () => {
  it('returns oldest first and pages with an opaque cursor (FR-CMT-2)', async () => {
    const { fixture, task } = await setup();

    for (let i = 1; i <= 5; i += 1) {
      await addComment(task.id, fixture.owner.auth, { body: `Comment ${String(i)}` });
    }

    const first = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments?limit=2`,
      headers: fixture.member.auth,
    });
    const firstPage = first.json<{ items: { body: string }[]; nextCursor: string | null }>();

    expect(firstPage.items.map((c) => c.body)).toEqual(['Comment 1', 'Comment 2']);
    expect(firstPage.nextCursor).toBeTruthy();

    const second = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments?limit=2&cursor=${encodeURIComponent(
        firstPage.nextCursor ?? '',
      )}`,
      headers: fixture.member.auth,
    });

    expect(second.json<{ items: { body: string }[] }>().items.map((c) => c.body)).toEqual([
      'Comment 3',
      'Comment 4',
    ]);
  });

  it('returns nextCursor null on the last page', async () => {
    const { fixture, task } = await setup();
    await addComment(task.id, fixture.owner.auth, { body: 'Only one' });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ nextCursor: string | null }>().nextCursor).toBeNull();
  });

  it('rejects a cursor this server did not issue', async () => {
    const { fixture, task } = await setup();

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments?cursor=bogus`,
      headers: fixture.owner.auth,
    });

    expect(response.statusCode).toBe(400);
  });

  it('excludes deleted comments', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.owner.auth, { body: 'Doomed' });

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json<{ id: string }>().id}`,
      headers: fixture.owner.auth,
    });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});

describe('PATCH /comments/{id}', () => {
  it('marks a comment edited once its version passes 1 (FR-CMT-3)', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.member.auth, { body: 'First draft' });
    const id = created.json<{ id: string }>().id;

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/comments/${id}`,
      headers: fixture.member.auth,
      payload: { version: 1, body: 'Second draft' },
    });

    expect(response.json()).toMatchObject({ body: 'Second draft', edited: true, version: 2 });
  });

  it('lets only the author edit, not even an ADMIN', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.member.auth, { body: 'Mine' });
    const id = created.json<{ id: string }>().id;

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/comments/${id}`,
      headers: fixture.admin.auth,
      payload: { version: 1, body: 'Words in your mouth' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 409 with the server copy on a stale version', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.member.auth, { body: 'Original' });
    const id = created.json<{ id: string }>().id;

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/comments/${id}`,
      headers: fixture.member.auth,
      payload: { version: 1, body: 'Edit one' },
    });

    const stale = await app().inject({
      method: 'PATCH',
      url: `/api/v1/comments/${id}`,
      headers: fixture.member.auth,
      payload: { version: 1, body: 'Edit two' },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ current: { body: string } }>().current.body).toBe('Edit one');
  });
});

describe('DELETE /comments/{id}', () => {
  it('lets the author delete their own', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.member.auth, { body: 'Mine' });

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json<{ id: string }>().id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(204);
  });

  it('lets an ADMIN delete anyone’s', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.member.auth, { body: 'Theirs' });

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json<{ id: string }>().id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(204);
  });

  it('stops another MEMBER deleting it', async () => {
    const { fixture, task } = await setup();
    const created = await addComment(task.id, fixture.owner.auth, { body: 'Not yours' });

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json<{ id: string }>().id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /workspaces/{id}/activity', () => {
  it('records one entry per write, newest first (FR-ACT-1, FR-ACT-2)', async () => {
    const { fixture, task } = await setup();

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
      payload: { version: 1, status: 'IN_PROGRESS' },
    });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/activity`,
      headers: fixture.member.auth,
    });

    const items = response.json<{ items: { summary: string; action: string }[] }>().items;

    expect(response.statusCode).toBe(200);
    // Newest first: the status change, then the task, then the board, then the members.
    expect(items[0]).toMatchObject({
      action: 'MOVED',
      summary: 'moved "Implement login screen" to In Progress',
    });
    expect(items.some((entry) => entry.summary.includes('created task'))).toBe(true);
    expect(items.some((entry) => entry.summary.includes('created board'))).toBe(true);
  });

  it('keeps the summary written at the time, not the current title', async () => {
    const { fixture, task } = await setup();

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
      payload: { version: 1, title: 'Renamed later' },
    });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/activity`,
      headers: fixture.owner.auth,
    });

    const items = response.json<{ items: { summary: string }[] }>().items;

    // The creation entry still names the original title.
    expect(items.some((entry) => entry.summary === 'created task "Implement login screen"')).toBe(
      true,
    );
  });

  it('pages with a cursor', async () => {
    const { fixture } = await setup();

    const first = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/activity?limit=2`,
      headers: fixture.owner.auth,
    });
    const page = first.json<{ items: unknown[]; nextCursor: string | null }>();

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();

    const second = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/activity?limit=2&cursor=${encodeURIComponent(
        page.nextCursor ?? '',
      )}`,
      headers: fixture.owner.auth,
    });

    expect(second.json<{ items: unknown[] }>().items.length).toBeGreaterThan(0);
  });

  it('returns 404 for a non-member', async () => {
    const { fixture } = await setup();

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/activity`,
      headers: fixture.outsider.auth,
    });

    expect(response.statusCode).toBe(404);
  });
});
