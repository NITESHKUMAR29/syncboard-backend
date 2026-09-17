import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { CloseCode } from '../../src/features/realtime/events.js';
import { createTestDatabase, type TestDatabase } from '../helpers/database.js';
import { testEnv } from '../helpers/env.js';
import { createWorkspaceFixture } from '../helpers/workspace.js';
import { createBoard } from '../helpers/workspace.js';
import type { FastifyInstance } from 'fastify';

/**
 * WebSocket events (FR-RT-1…3).
 *
 * These need a real socket on a real port, so unlike the other suites this one listens
 * rather than using app.inject().
 */

let database: TestDatabase;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await buildApp({ env: testEnv(), prisma: database.prisma });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${String(address.port)}/api/v1`;
});

afterAll(async () => {
  await app.close();
  await database.close();
});

/** Opens a socket and resolves once it is connected, or rejects with the close code. */
function connect(workspaceId: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}/ws/workspaces/${workspaceId}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    socket.once('open', () => {
      resolve(socket);
    });
    socket.once('close', (code: number) => {
      reject(new Error(`closed with ${String(code)}`));
    });
    socket.once('error', reject);
  });
}

/** Resolves with the close code, for the rejection paths. */
function expectClose(workspaceId: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}/ws/workspaces/${workspaceId}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    socket.once('close', (code: number) => {
      resolve(code);
    });
    socket.once('error', () => {
      // A rejected upgrade surfaces as an error on some paths; the close code follows.
    });
    setTimeout(() => {
      reject(new Error('socket never closed'));
    }, 5_000).unref();
  });
}

interface ReceivedEvent {
  type: string;
  workspaceId: string;
  actorId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Waits for the next event frame. */
async function nextEvent(socket: WebSocket): Promise<ReceivedEvent> {
  const [raw] = (await once(socket, 'message')) as [Buffer];
  return JSON.parse(raw.toString()) as ReceivedEvent;
}

describe('WebSocket connection (FR-RT-1)', () => {
  it('accepts a member presenting a valid token', async () => {
    const fixture = await createWorkspaceFixture(app);

    const socket = await connect(fixture.id, fixture.member.accessToken);

    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('rejects a non-member with 4403', async () => {
    const fixture = await createWorkspaceFixture(app);

    const code = await expectClose(fixture.id, fixture.outsider.accessToken);

    expect(code).toBe(CloseCode.NOT_A_MEMBER);
  });

  it('rejects an invalid token with 4401', async () => {
    const fixture = await createWorkspaceFixture(app);

    const code = await expectClose(fixture.id, 'not-a-real-token');

    expect(code).toBe(CloseCode.TOKEN_INVALID);
  });
});

describe('event broadcast (FR-RT-2)', () => {
  it('delivers a TASK_CREATED event after a REST write', async () => {
    const fixture = await createWorkspaceFixture(app);
    const boardId = await createBoard(app, fixture.id, fixture.owner);

    const socket = await connect(fixture.id, fixture.member.accessToken);
    const received = nextEvent(socket);

    await app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'Live update' },
    });

    const event = await received;

    expect(event.type).toBe('TASK_CREATED');
    expect(event.workspaceId).toBe(fixture.id);
    expect(event.actorId).toBe(fixture.owner.id);
    expect(event.payload).toMatchObject({ title: 'Live update' });

    socket.close();
  });

  it('also reaches the actor’s own other devices', async () => {
    const fixture = await createWorkspaceFixture(app);
    const boardId = await createBoard(app, fixture.id, fixture.owner);

    // The same user, connected twice: a phone and a tablet.
    const socket = await connect(fixture.id, fixture.owner.accessToken);
    const received = nextEvent(socket);

    await app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'From my other device' },
    });

    const event = await received;

    expect(event.type).toBe('TASK_CREATED');
    expect(event.actorId).toBe(fixture.owner.id);

    socket.close();
  });

  it('does not leak events to another workspace', async () => {
    const first = await createWorkspaceFixture(app, 'First');
    const second = await createWorkspaceFixture(app, 'Second');
    const boardId = await createBoard(app, first.id, first.owner);

    const listener = await connect(second.id, second.owner.accessToken);
    let leaked = false;
    listener.on('message', () => {
      leaked = true;
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: first.owner.auth,
      payload: { title: 'Private' },
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(leaked).toBe(false);
    listener.close();
  });

  it('delivers BOARD_UPDATED and TASK_DELETED', async () => {
    const fixture = await createWorkspaceFixture(app);
    const boardId = await createBoard(app, fixture.id, fixture.owner);

    const socket = await connect(fixture.id, fixture.member.accessToken);

    const boardEvent = nextEvent(socket);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/boards/${boardId}`,
      headers: fixture.owner.auth,
      payload: { version: 1, title: 'Renamed live' },
    });
    expect((await boardEvent).type).toBe('BOARD_UPDATED');

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/boards/${boardId}/tasks`,
      headers: fixture.owner.auth,
      payload: { title: 'Doomed' },
    });
    await nextEvent(socket); // TASK_CREATED

    const deleteEvent = nextEvent(socket);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${created.json<{ id: string }>().id}`,
      headers: fixture.owner.auth,
    });

    const event = await deleteEvent;
    expect(event.type).toBe('TASK_DELETED');
    expect(event.payload).toMatchObject({ boardId });

    socket.close();
  });
});

describe('membership changes (FR-RT-3)', () => {
  it('closes a removed member’s socket with 4403', async () => {
    const fixture = await createWorkspaceFixture(app);

    const socket = await connect(fixture.id, fixture.member.accessToken);
    const closed = once(socket, 'close');

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.member.id}`,
      headers: fixture.owner.auth,
    });

    const [code] = (await closed) as [number];
    expect(code).toBe(CloseCode.NOT_A_MEMBER);
  });

  it('closes every socket with 4404 when the workspace is deleted', async () => {
    const fixture = await createWorkspaceFixture(app);

    const socket = await connect(fixture.id, fixture.member.accessToken);
    const closed = once(socket, 'close');

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.owner.auth,
    });

    const [code] = (await closed) as [number];
    expect(code).toBe(CloseCode.WORKSPACE_GONE);
  });
});
