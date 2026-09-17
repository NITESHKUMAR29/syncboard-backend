import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Boards (FR-BRD-1…4). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

describe('POST /workspaces/{id}/boards', () => {
  it('appends boards at 1000, 2000, … (FR-BRD-1)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const first = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.admin.auth,
      payload: { title: 'First' },
    });
    const second = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.admin.auth,
      payload: { title: 'Second' },
    });

    expect(first.json<{ position: number }>().position).toBe(1000);
    expect(second.json<{ position: number }>().position).toBe(2000);
  });

  it('starts a new board at version 1 with no tasks', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.owner.auth,
      payload: { title: 'Sprint 12' },
    });

    expect(response.json()).toMatchObject({ version: 1, taskCount: 0, archived: false });
  });

  it('denies a MEMBER (A9: board creation is ADMIN and above)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.member.auth,
      payload: { title: 'Not allowed' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for a non-member rather than revealing the workspace', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.outsider.auth,
      payload: { title: 'Nope' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /workspaces/{id}/boards', () => {
  it('orders by position and hides archived boards (FR-BRD-2)', async () => {
    const fixture = await createWorkspaceFixture(app());
    await createBoard(app(), fixture.id, fixture.owner, 'Visible');
    const archivedId = await createBoard(app(), fixture.id, fixture.owner, 'Archived');

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${archivedId}`,
      headers: fixture.owner.auth,
      payload: { version: 1, archived: true },
    });

    const hidden = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/boards`,
      headers: fixture.member.auth,
    });
    const shown = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/boards?includeArchived=true`,
      headers: fixture.member.auth,
    });

    expect(hidden.json<{ title: string }[]>().map((b) => b.title)).toEqual(['Visible']);
    expect(shown.json<unknown[]>()).toHaveLength(2);
  });

  it('counts only tasks that are not deleted (FR-BRD-2)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const kept = await createTask(app(), boardId, fixture.owner, { title: 'Kept' });
    const removed = await createTask(app(), boardId, fixture.owner, { title: 'Removed' });

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${removed.id}`,
      headers: fixture.owner.auth,
    });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.member.auth,
    });

    expect(response.json<{ taskCount: number }>().taskCount).toBe(1);
    expect(kept.id).toBeDefined();
  });
});

describe('PATCH /boards/{id}', () => {
  it('bumps the version on a successful edit (FR-BRD-3)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.admin.auth,
      payload: { version: 1, title: 'Renamed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ title: 'Renamed', version: 2 });
  });

  it('returns 409 VERSION_CONFLICT with the server copy in `current`', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.owner.auth,
      payload: { version: 1, title: 'First edit wins' },
    });

    const stale = await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.admin.auth,
      payload: { version: 1, title: 'Second edit loses' },
    });

    const body = stale.json<{
      error: { code: string };
      current: { version: number; title: string };
    }>();

    expect(stale.statusCode).toBe(409);
    expect(body.error.code).toBe('VERSION_CONFLICT');
    // The client re-applies its change on top of this.
    expect(body.current).toMatchObject({ version: 2, title: 'First edit wins' });
  });

  it('denies a MEMBER', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.member.auth,
      payload: { version: 1, title: 'Nope' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('requires a version', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.owner.auth,
      payload: { title: 'No version' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /boards/{id}', () => {
  it('soft deletes the board and every task on it (FR-BRD-4)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(204);

    // Both are gone from the API; /sync still reports them so offline clients catch up.
    const board = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.owner.auth,
    });
    const taskAfter = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    expect(board.statusCode).toBe(404);
    expect(taskAfter.statusCode).toBe(404);
  });

  it('denies a MEMBER', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(403);
  });
});
