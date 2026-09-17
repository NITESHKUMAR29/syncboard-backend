import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDueSoonJob, nextUtcDay } from '../../src/jobs/due-soon.js';
import { fixedClock } from '../../src/common/clock.js';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { createFakePushSender, type FakePushSender } from '../helpers/push.js';
import { createBoard, createTask, createWorkspaceFixture } from '../helpers/workspace.js';

/** Push triggers (FR-PUSH-1…3), verified with a fake sender. */

let testApp: TestApp;
let push: FakePushSender;

beforeAll(async () => {
  push = createFakePushSender();
  testApp = await buildTestApp({ push });
});

beforeEach(() => {
  push.clear();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

describe('TASK_ASSIGNED', () => {
  it('notifies a new assignee', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    push.clear();

    await createTask(app(), boardId, fixture.owner, {
      title: 'Implement login screen',
      assigneeId: fixture.member.id,
    });

    const messages = push.ofType('TASK_ASSIGNED');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.userIds).toEqual([fixture.member.id]);
    expect(messages[0]?.data).toMatchObject({
      title: 'New task assigned',
      deepLink: expect.stringMatching(/^taskflow:\/\/tasks\//) as unknown,
    });
  });

  it('never notifies the actor about their own action (FR-PUSH-1)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    push.clear();

    // Assigning a task to yourself is not news to you.
    await createTask(app(), boardId, fixture.owner, {
      title: 'Mine',
      assigneeId: fixture.owner.id,
    });

    expect(push.ofType('TASK_ASSIGNED')).toHaveLength(0);
  });

  it('notifies on reassignment but not on unrelated edits', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    const task = await createTask(app(), boardId, fixture.owner);
    push.clear();

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
      payload: { version: 1, priority: 'HIGH' },
    });
    expect(push.ofType('TASK_ASSIGNED')).toHaveLength(0);

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
      payload: { version: 2, assigneeId: fixture.member.id },
    });
    expect(push.ofType('TASK_ASSIGNED')).toHaveLength(1);
  });

  it('sends all values as strings, as FCM data payloads require', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    push.clear();

    await createTask(app(), boardId, fixture.owner, { assigneeId: fixture.member.id });

    const data = push.ofType('TASK_ASSIGNED')[0]?.data ?? {};
    expect(Object.values(data).every((value) => typeof value === 'string')).toBe(true);
  });
});

describe('WORKSPACE_INVITE', () => {
  it('notifies the added user, not the adder (FR-MEM-1)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const messages = push.ofType('WORKSPACE_INVITE');

    // The fixture adds an admin and a member.
    expect(messages).toHaveLength(2);
    expect(messages.flatMap((message) => message.userIds)).not.toContain(fixture.owner.id);
  });
});

describe('COMMENT_ADDED and MENTIONED', () => {
  async function scenario() {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    // Created by the owner, assigned to the admin.
    const task = await createTask(app(), boardId, fixture.owner, {
      assigneeId: fixture.admin.id,
    });
    push.clear();
    return { fixture, task };
  }

  it('notifies the assignee and the creator', async () => {
    const { fixture, task } = await scenario();

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.member.auth,
      payload: { body: 'Looks good' },
    });

    const recipients = push.ofType('COMMENT_ADDED').flatMap((message) => message.userIds);

    expect(recipients).toContain(fixture.owner.id);
    expect(recipients).toContain(fixture.admin.id);
    expect(recipients).not.toContain(fixture.member.id);
  });

  it('does not notify the commenter even when they are the assignee', async () => {
    const { fixture, task } = await scenario();

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.admin.auth,
      payload: { body: 'Working on it' },
    });

    const recipients = push.ofType('COMMENT_ADDED').flatMap((message) => message.userIds);

    expect(recipients).not.toContain(fixture.admin.id);
    expect(recipients).toEqual([fixture.owner.id]);
  });

  it('sends MENTIONED to a member named with @NameWithoutSpaces (A9)', async () => {
    const { fixture, task } = await scenario();
    const handle = fixture.member.name.replace(/\s+/g, '');

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.owner.auth,
      payload: { body: `Can you look at this @${handle}?` },
    });

    const mentioned = push.ofType('MENTIONED');

    expect(mentioned).toHaveLength(1);
    expect(mentioned[0]?.userIds).toEqual([fixture.member.id]);
  });

  it('matches a mention case-insensitively', async () => {
    const { fixture, task } = await scenario();
    const handle = fixture.member.name.replace(/\s+/g, '').toUpperCase();

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.owner.auth,
      payload: { body: `ping @${handle}` },
    });

    expect(push.ofType('MENTIONED')[0]?.userIds).toEqual([fixture.member.id]);
  });

  it('ignores a mention that matches nobody', async () => {
    const { fixture, task } = await scenario();

    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.owner.auth,
      payload: { body: 'email me @ nobody or @Ghost' },
    });

    expect(push.ofType('MENTIONED')).toHaveLength(0);
  });

  it('does not notify a mentioned person twice as a follower', async () => {
    const { fixture, task } = await scenario();
    const handle = fixture.admin.name.replace(/\s+/g, '');

    // The admin is the assignee and is also mentioned.
    await app().inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/comments`,
      headers: fixture.member.auth,
      payload: { body: `over to you @${handle}` },
    });

    const timesNotified = push.sent
      .flatMap((message) => message.userIds)
      .filter((id) => id === fixture.admin.id).length;

    expect(timesNotified).toBe(1);
  });
});

describe('TASK_DUE_SOON (FR-PUSH-3)', () => {
  it('notifies assignees of tasks due the next UTC day', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);

    const clock = fixedClock(new Date('2026-09-17T09:00:00Z'));
    const tomorrow = '2026-09-18';

    await createTask(app(), boardId, fixture.owner, {
      title: 'Due tomorrow',
      assigneeId: fixture.member.id,
      dueDate: tomorrow,
    });
    await createTask(app(), boardId, fixture.owner, {
      title: 'Due later',
      assigneeId: fixture.member.id,
      dueDate: '2026-09-25',
    });
    await createTask(app(), boardId, fixture.owner, {
      title: 'Done already',
      assigneeId: fixture.member.id,
      dueDate: tomorrow,
      status: 'DONE',
    });
    await createTask(app(), boardId, fixture.owner, {
      title: 'Nobody assigned',
      dueDate: tomorrow,
    });
    push.clear();

    const job = createDueSoonJob({
      db: testApp.prisma,
      push,
      clock,
      logger: { info: () => undefined, error: () => undefined },
    });

    const notified = await job.runOnce();
    job.stop();

    expect(notified).toBe(1);
    expect(push.ofType('TASK_DUE_SOON')).toHaveLength(1);
    expect(push.ofType('TASK_DUE_SOON')[0]?.data.body).toContain('Due tomorrow');
  });

  it('skips soft-deleted tasks', async () => {
    const fixture = await createWorkspaceFixture(app());
    const boardId = await createBoard(app(), fixture.id, fixture.owner);
    // The job sweeps every workspace, so this uses a date no other test touches.
    const clock = fixedClock(new Date('2026-10-10T09:00:00Z'));

    const task = await createTask(app(), boardId, fixture.owner, {
      title: 'Deleted but due',
      assigneeId: fixture.member.id,
      dueDate: '2026-10-11',
    });
    await app().inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}`,
      headers: fixture.owner.auth,
    });
    push.clear();

    const job = createDueSoonJob({
      db: testApp.prisma,
      push,
      clock,
      logger: { info: () => undefined, error: () => undefined },
    });

    expect(await job.runOnce()).toBe(0);
    job.stop();
  });
});

describe('nextUtcDay', () => {
  it('is midnight UTC of the following day', () => {
    expect(nextUtcDay(new Date('2026-09-17T09:00:00Z')).toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    );
  });

  it('rolls over a month boundary', () => {
    expect(nextUtcDay(new Date('2026-09-30T23:59:59Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
});
