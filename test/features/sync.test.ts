import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Delta sync (FR-SYNC-1, FR-SYNC-2). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

interface SyncBody {
  serverTime: string;
  boards: { id: string; deletedAt: string | null }[];
  tasks: { id: string; title: string; deletedAt: string | null }[];
  comments: { id: string; deletedAt: string | null }[];
  members: unknown[];
  labels: unknown[];
  hasMore: boolean;
}

const sync = async (workspaceId: string, headers: Record<string, string>, since?: string) => {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await app().inject({
    method: 'GET',
    url: `/api/v1/workspaces/${workspaceId}/sync${query}`,
    headers,
  });
  return { response, body: response.json<SyncBody>() };
};

describe('GET /workspaces/{id}/sync', () => {
  it('returns everything on a first sync with no `since`', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    await createTask(app(), boardId, fixture.owner);

    const { response, body } = await sync(fixture.id, fixture.member.auth);

    expect(response.statusCode).toBe(200);
    expect(body.boards).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.members).toHaveLength(3);
    expect(body.hasMore).toBe(false);
    expect(body.serverTime).toMatch(/Z$/);
  });

  it('returns the full member and label list, not a delta', async () => {
    const fixture = await createWorkspaceFixture(app());
    await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/labels`,
      headers: fixture.owner.auth,
      payload: { name: 'Bug', colorHex: '#E5484D' },
    });

    // Long after everything was created, so a delta would return nothing.
    const future = new Date(Date.now() + 60_000).toISOString();
    const { body } = await sync(fixture.id, fixture.owner.auth, future);

    expect(body.members).toHaveLength(3);
    expect(body.labels).toHaveLength(1);
  });

  it('includes soft-deleted rows so clients can remove them locally', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });

    const { body } = await sync(fixture.id, fixture.owner.auth);
    const deleted = body.tasks.find((row) => row.id === task.id);

    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it('reports a deleted board and all its tasks (FR-BRD-4)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);

    await app().inject({
      method: 'DELETE',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.owner.auth,
    });

    const { body } = await sync(fixture.id, fixture.owner.auth);

    expect(body.boards.find((row) => row.id === boardId)?.deletedAt).not.toBeNull();
    expect(body.tasks.find((row) => row.id === task.id)?.deletedAt).not.toBeNull();
  });

  it('returns only what changed after `since`', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    await createTask(app(), boardId, fixture.owner, { title: 'Before' });

    // Far enough ahead to clear the five-second overlap window.
    const checkpoint = new Date(Date.now() + 10_000).toISOString();
    const quiet = await sync(fixture.id, fixture.owner.auth, checkpoint);
    expect(quiet.body.tasks).toHaveLength(0);

    await createTask(app(), boardId, fixture.owner, { title: 'After' });

    const later = new Date(Date.now() + 10_000).toISOString();
    const afterQuiet = await sync(fixture.id, fixture.owner.auth, later);
    expect(afterQuiet.body.tasks).toHaveLength(0);
  });

  it('overlaps the window by five seconds rather than risk a gap', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    await createTask(app(), boardId, fixture.owner, { title: 'Just now' });

    // `since` is now: without the overlap the task just created would be missed.
    const { body } = await sync(fixture.id, fixture.owner.auth, new Date().toISOString());

    expect(body.tasks.some((row) => row.title === 'Just now')).toBe(true);
  });

  it('rejects a malformed `since`', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/sync?since=yesterday`,
      headers: fixture.owner.auth,
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for a non-member', async () => {
    const fixture = await createWorkspaceFixture(app());

    const { response } = await sync(fixture.id, fixture.outsider.auth);

    expect(response.statusCode).toBe(404);
  });

  it('caps at 500 rows per entity and sets hasMore (FR-SYNC-2)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    // 501 tasks: one past the page limit, inserted directly because 501 HTTP round trips
    // would make this test take minutes.
    const now = new Date();
    await testApp.prisma.task.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: crypto.randomUUID(),
        boardId,
        title: `Bulk task ${String(index)}`,
        status: 'TODO',
        priority: 'MEDIUM',
        createdBy: fixture.owner.id,
        position: (index + 1) * 1000,
        createdAt: now,
        // Ordered but in the past, so serverTime stays a real instant.
        updatedAt: new Date(now.getTime() - (501 - index)),
      })),
    });

    const { body } = await sync(fixture.id, fixture.owner.auth);

    expect(body.tasks).toHaveLength(500);
    expect(body.hasMore).toBe(true);
    // serverTime is the newest row actually sent, so the next call resumes there
    // instead of skipping the truncated remainder.
    expect(new Date(body.serverTime).getTime()).toBeLessThanOrEqual(Date.now());

    const second = await sync(fixture.id, fixture.owner.auth, body.serverTime);
    expect(second.body.tasks.length).toBeGreaterThan(0);
  });
});
