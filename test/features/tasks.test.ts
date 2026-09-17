import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Tasks (FR-TSK-1…8). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

const patch = (taskId: string, headers: Record<string, string>, payload: Record<string, unknown>) =>
  app().inject({ method: 'PATCH', url: `/api/v1/tasks/${taskId}`, headers, payload });

describe('POST /boards/{id}/tasks', () => {
  it('defaults status to TODO and priority to MEDIUM (FR-TSK-1)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.member.auth,
      payload: { title: 'Implement login screen' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      title: 'Implement login screen',
      status: 'TODO',
      priority: 'MEDIUM',
      assignee: null,
      dueDate: null,
      labels: [],
      commentCount: 0,
      attachmentCount: 0,
      version: 1,
      position: 1000,
    });
  });

  it('lets a MEMBER create tasks', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const task = await createTask(app(), boardId, fixture.member);

    expect(task.id).toBeDefined();
  });

  it('appends each task 1000 past the last', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    await createTask(app(), boardId, fixture.owner, { title: 'First' });
    const second = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'Second' },
    });

    expect(second.json<{ position: number }>().position).toBe(2000);
  });

  it('rejects an assignee who is not a workspace member (FR-TSK-4)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'Bad assignee', assigneeId: fixture.outsider.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({
      assigneeId: 'NOT_A_MEMBER',
    });
  });

  it('rejects labels from another workspace', async () => {
    const first = await createWorkspaceFixture(app(), 'First');
    const second = await createWorkspaceFixture(app(), 'Second');
    const boardId = await createBoard(app(), first.id, first.owner);

    const label = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${second.id}/labels`,
      headers: second.owner.auth,
      payload: { name: 'Foreign', colorHex: '#E5484D' },
    });

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: first.owner.auth,
      payload: { title: 'Bad label', labelIds: [label.json<{ id: string }>().id] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a title longer than 200 characters', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'x'.repeat(201) },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('idempotent create (FR-TSK-2)', () => {
  it('returns 200 and the existing task when the same id is sent twice', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const clientId = randomUUID();

    const first = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.member.auth,
      payload: { id: clientId, title: 'Sent twice' },
    });

    // The offline outbox retries: same id, same everything.
    const second = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.member.auth,
      payload: { id: clientId, title: 'Sent twice' },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(clientId);

    // And there is exactly one task, not two.
    const list = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.member.auth,
    });
    expect(list.json<{ totalItems: number }>().totalItems).toBe(1);
  });

  it('does not overwrite the stored task with the retry payload', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const clientId = randomUUID();

    await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { id: clientId, title: 'Original' },
    });

    const retry = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { id: clientId, title: 'Different title' },
    });

    expect(retry.json<{ title: string }>().title).toBe('Original');
  });

  it('rejects an id belonging to someone else with fields.id = ID_TAKEN', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const clientId = randomUUID();

    await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { id: clientId, title: 'Mine' },
    });

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.member.auth,
      payload: { id: clientId, title: 'Yours' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({
      id: 'ID_TAKEN',
    });
  });
});

describe('GET /boards/{id}/tasks', () => {
  it('filters by status, priority and assignee', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    await createTask(app(), boardId, fixture.owner, { title: 'Todo low', priority: 'LOW' });
    await createTask(app(), boardId, fixture.owner, {
      title: 'Done urgent',
      status: 'DONE',
      priority: 'URGENT',
      assigneeId: fixture.member.id,
    });

    const byStatus = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks?status=DONE`,
      headers: fixture.owner.auth,
    });
    const byPriority = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks?priority=LOW`,
      headers: fixture.owner.auth,
    });
    const byAssignee = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks?assigneeId=${fixture.member.id}`,
      headers: fixture.owner.auth,
    });

    expect(byStatus.json<{ totalItems: number }>().totalItems).toBe(1);
    expect(byPriority.json<{ totalItems: number }>().totalItems).toBe(1);
    expect(byAssignee.json<{ totalItems: number }>().totalItems).toBe(1);
  });

  it('resolves assigneeId=me to the caller (FR-TSK-3)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    await createTask(app(), boardId, fixture.owner, {
      title: 'Mine',
      assigneeId: fixture.member.id,
    });
    await createTask(app(), boardId, fixture.owner, { title: 'Unassigned' });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks?assigneeId=me`,
      headers: fixture.member.auth,
    });

    expect(response.json<{ items: { title: string }[] }>().items.map((t) => t.title)).toEqual([
      'Mine',
    ]);
  });

  it('sorts by priority from URGENT down, not alphabetically', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    for (const priority of ['LOW', 'URGENT', 'MEDIUM', 'HIGH']) {
      await createTask(app(), boardId, fixture.owner, { title: priority, priority });
    }

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks?sort=priority`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ items: { title: string }[] }>().items.map((t) => t.title)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
    ]);
  });

  it('excludes deleted tasks', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ totalItems: number }>().totalItems).toBe(0);
  });
});

describe('PATCH /tasks/{id}', () => {
  it('leaves absent fields untouched and clears explicit nulls (FR-TSK-4)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner, {
      title: 'Has everything',
      description: 'Some notes',
      assigneeId: fixture.member.id,
      dueDate: '2026-09-30',
    });

    // Only status is sent, so description, assignee and dueDate must survive.
    const partial = await patch(task.id, fixture.owner.auth, {
      version: 1,
      status: 'IN_PROGRESS',
    });

    expect(partial.json()).toMatchObject({
      status: 'IN_PROGRESS',
      description: 'Some notes',
      dueDate: '2026-09-30',
      assignee: { id: fixture.member.id },
    });

    // Explicit nulls clear them.
    const cleared = await patch(task.id, fixture.owner.auth, {
      version: 2,
      description: null,
      assigneeId: null,
      dueDate: null,
    });

    expect(cleared.json()).toMatchObject({
      description: null,
      assignee: null,
      dueDate: null,
      status: 'IN_PROGRESS',
    });
  });

  it('formats dueDate from UTC parts, so the day never shifts', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner, { dueDate: '2026-09-30' });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ dueDate: string }>().dueDate).toBe('2026-09-30');
  });

  it('returns 409 with the current task on a stale version (FR-TSK-5)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    // Device B edits first.
    await patch(task.id, fixture.member.auth, { version: 1, status: 'IN_PROGRESS' });

    // Device A comes back online with a stale version.
    const stale = await patch(task.id, fixture.owner.auth, { version: 1, priority: 'HIGH' });
    const body = stale.json<{ error: { code: string }; current: { version: number } }>();

    expect(stale.statusCode).toBe(409);
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.current).toMatchObject({ version: 2, status: 'IN_PROGRESS' });

    // Re-applying on top of the server's version succeeds.
    const retry = await patch(task.id, fixture.owner.auth, { version: 2, priority: 'HIGH' });
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ version: number }>().version).toBe(3);
  });

  it('returns 404, not 409, when editing a deleted task (FR-TSK-5)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    const response = await patch(task.id, fixture.owner.auth, { version: 1, priority: 'HIGH' });

    expect(response.statusCode).toBe(404);
  });

  it('moves a task to another board in the same workspace', async () => {
    const fixture = await createWorkspaceFixture(app());
    const from = await createBoard(app(), fixture.id, fixture.owner, 'From');
    const to = await createBoard(app(), fixture.id, fixture.owner, 'To');
    const task = await createTask(app(), from, fixture.owner);

    const response = await patch(task.id, fixture.owner.auth, {
      version: 1,
      boardId: to,
      position: 500,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ boardId: string }>().boardId).toBe(to);
  });

  it('refuses to move a task into another workspace', async () => {
    const first = await createWorkspaceFixture(app(), 'First');
    const second = await createWorkspaceFixture(app(), 'Second');
    const from = await createBoard(app(), first.id, first.owner);
    const elsewhere = await createBoard(app(), second.id, second.owner);
    const task = await createTask(app(), from, first.owner);

    const response = await patch(task.id, first.owner.auth, { version: 1, boardId: elsewhere });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({
      boardId: 'DIFFERENT_WORKSPACE',
    });
  });

  it('replaces the label set when labelIds is sent', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    const label = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/labels`,
      headers: fixture.owner.auth,
      payload: { name: 'Bug', colorHex: '#E5484D' },
    });
    const labelId = label.json<{ id: string }>().id;

    const added = await patch(task.id, fixture.owner.auth, { version: 1, labelIds: [labelId] });
    expect(added.json<{ labels: unknown[] }>().labels).toHaveLength(1);

    const removed = await patch(task.id, fixture.owner.auth, { version: 2, labelIds: [] });
    expect(removed.json<{ labels: unknown[] }>().labels).toHaveLength(0);
  });

  it('renumbers the board once positions get too close (FR-TSK-7)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    await createTask(app(), boardId, fixture.owner, { title: 'A', position: 1000 });
    const b = await createTask(app(), boardId, fixture.owner, { title: 'B', position: 2000 });

    // Drop B a hair above A: the gap is under 0.0001, so halving again would run out of
    // precision and the server must spread the board back out.
    await patch(b.id, fixture.owner.auth, { version: 1, position: 1000.00001 });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
    });

    expect(response.json<{ items: { position: number }[] }>().items.map((t) => t.position)).toEqual(
      [1000, 2000],
    );
  });
});

describe('DELETE /tasks/{id}', () => {
  it('lets the creator delete their own task (FR-TSK-6)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.member);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(204);
  });

  it('stops a MEMBER deleting someone else’s task', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets an ADMIN delete anyone’s task', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.member);

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(204);
  });
});

describe('GET /me/tasks (FR-TSK-8)', () => {
  it('returns tasks assigned to the caller across workspaces', async () => {
    const first = await createWorkspaceFixture(app(), 'First');
    const boardId = await createBoard(app(), first.id, first.owner);

    await createTask(app(), boardId, first.owner, {
      title: 'Assigned to member',
      assigneeId: first.member.id,
    });
    await createTask(app(), boardId, first.owner, { title: 'Not assigned' });

    const response = await app().inject({
      method: 'GET',
      url: '/api/v1/me/tasks',
      headers: first.member.auth,
    });

    expect(response.json<{ items: { title: string }[] }>().items.map((t) => t.title)).toEqual([
      'Assigned to member',
    ]);
  });

  it('drops tasks in workspaces the caller has left', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    await createTask(app(), boardId, fixture.owner, {
      title: 'Theirs now',
      assigneeId: fixture.member.id,
    });

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/me`,
      headers: fixture.member.auth,
    });

    const response = await app().inject({
      method: 'GET',
      url: '/api/v1/me/tasks',
      headers: fixture.member.auth,
    });

    expect(response.json<{ totalItems: number }>().totalItems).toBe(0);
  });
});
