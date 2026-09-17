import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { registerUser } from '../helpers/factories.js';
import { createWorkspaceFixture } from '../helpers/workspace.js';

/** Workspaces, members and labels (FR-WS, FR-MEM, FR-LBL) and the Part B §6 matrix. */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const app = () => testApp.app;

describe('POST /workspaces', () => {
  it('makes the creator an OWNER with memberCount 1 (FR-WS-1)', async () => {
    const user = await registerUser(app());

    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: user.auth,
      payload: { name: 'Mobile Team' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Mobile Team',
      ownerId: user.id,
      myRole: 'OWNER',
      memberCount: 1,
    });
  });

  it('requires authentication', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: 'No token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an empty name', async () => {
    const user = await registerUser(app());

    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: user.auth,
      payload: { name: '   ' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /workspaces', () => {
  it('lists only workspaces the caller belongs to (FR-WS-2)', async () => {
    const fixture = await createWorkspaceFixture(app(), 'Visible');

    const mine = await app().inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: fixture.member.auth,
    });
    const theirs = await app().inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: fixture.outsider.auth,
    });

    expect(mine.json<{ items: { id: string }[] }>().items.map((w) => w.id)).toContain(fixture.id);
    expect(theirs.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it('returns the documented pagination envelope', async () => {
    const user = await registerUser(app());

    const response = await app().inject({
      method: 'GET',
      url: '/api/v1/workspaces?page=1&size=20',
      headers: user.auth,
    });

    expect(response.json()).toMatchObject({ page: 1, size: 20, totalItems: 0, totalPages: 0 });
  });
});

describe('GET /workspaces/{id}', () => {
  it('lets a MEMBER see it, reporting their own role', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ myRole: 'MEMBER', memberCount: 3 });
  });

  it('returns 404 rather than 403 for a non-member, so ids cannot be probed', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.outsider.auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /workspaces/{id} — rename needs ADMIN', () => {
  it('allows an ADMIN', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.admin.auth,
      payload: { name: 'Mobile Squad' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ name: string }>().name).toBe('Mobile Squad');
  });

  it('denies a MEMBER with 403', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.member.auth,
      payload: { name: 'Nope' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });
});

describe('DELETE /workspaces/{id} — delete needs OWNER', () => {
  it('allows the OWNER and removes it', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.owner.auth,
    });

    expect(response.statusCode).toBe(204);

    const after = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.owner.auth,
    });
    expect(after.statusCode).toBe(404);
  });

  it('denies an ADMIN with 403', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('members', () => {
  it('lets an ADMIN add a member (FR-MEM-1)', async () => {
    const fixture = await createWorkspaceFixture(app());
    const newcomer = await registerUser(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/members`,
      headers: fixture.admin.auth,
      payload: { email: newcomer.email, role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ role: 'MEMBER', user: { email: newcomer.email } });
  });

  it('denies a MEMBER adding anyone', async () => {
    const fixture = await createWorkspaceFixture(app());
    const newcomer = await registerUser(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/members`,
      headers: fixture.member.auth,
      payload: { email: newcomer.email, role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for an email with no account', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/members`,
      headers: fixture.owner.auth,
      payload: { email: 'nobody@example.com', role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 409 ALREADY_MEMBER for someone already in', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/members`,
      headers: fixture.owner.auth,
      payload: { email: fixture.member.email, role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('ALREADY_MEMBER');
  });

  it('stops an ADMIN from adding an OWNER', async () => {
    const fixture = await createWorkspaceFixture(app());
    const newcomer = await registerUser(app());

    const response = await app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${fixture.id}/members`,
      headers: fixture.admin.auth,
      payload: { email: newcomer.email, role: 'OWNER' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets the OWNER change a role (FR-MEM-2)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.member.id}`,
      headers: fixture.owner.auth,
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string }>().role).toBe('ADMIN');
  });

  it('denies an ADMIN changing roles', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.member.id}`,
      headers: fixture.admin.auth,
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses to demote the last OWNER (FR-MEM-2)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.owner.id}`,
      headers: fixture.owner.auth,
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LAST_OWNER');
  });

  it('allows demoting an OWNER once a second one exists', async () => {
    const fixture = await createWorkspaceFixture(app());

    await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.admin.id}`,
      headers: fixture.owner.auth,
      payload: { role: 'OWNER' },
    });

    const response = await app().inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.owner.id}`,
      headers: fixture.owner.auth,
      payload: { role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('lets an ADMIN remove a MEMBER (FR-MEM-3)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.member.id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(204);
  });

  it('stops an ADMIN removing an OWNER', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.owner.id}`,
      headers: fixture.admin.auth,
    });

    expect(response.statusCode).toBe(403);
  });

  it('stops a MEMBER removing anyone else', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/${fixture.admin.id}`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets a MEMBER leave with `me`', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/me`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(204);

    const after = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}`,
      headers: fixture.member.auth,
    });
    expect(after.statusCode).toBe(404);
  });

  it('stops the last OWNER leaving (FR-MEM-3)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await app().inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${fixture.id}/members/me`,
      headers: fixture.owner.auth,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('LAST_OWNER');
  });
});

describe('labels', () => {
  const createLabel = (
    workspaceId: string,
    headers: Record<string, string>,
    payload: Record<string, unknown>,
  ) =>
    app().inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/labels`,
      headers,
      payload,
    });

  it('lets an ADMIN create one (FR-LBL-1)', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await createLabel(fixture.id, fixture.admin.auth, {
      name: 'Bug',
      colorHex: '#E5484D',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Bug', colorHex: '#E5484D' });
  });

  it('denies a MEMBER', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await createLabel(fixture.id, fixture.member.auth, {
      name: 'Nope',
      colorHex: '#E5484D',
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects a malformed colour', async () => {
    const fixture = await createWorkspaceFixture(app());

    const response = await createLabel(fixture.id, fixture.owner.auth, {
      name: 'Bad',
      colorHex: 'red',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a duplicate name differing only in case', async () => {
    const fixture = await createWorkspaceFixture(app());
    await createLabel(fixture.id, fixture.owner.auth, { name: 'Bug', colorHex: '#E5484D' });

    const response = await createLabel(fixture.id, fixture.owner.auth, {
      name: 'bug',
      colorHex: '#000000',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({
      name: 'ALREADY_EXISTS',
    });
  });

  it('allows the same name in a different workspace', async () => {
    const first = await createWorkspaceFixture(app(), 'First');
    const second = await createWorkspaceFixture(app(), 'Second');

    await createLabel(first.id, first.owner.auth, { name: 'Bug', colorHex: '#E5484D' });
    const response = await createLabel(second.id, second.owner.auth, {
      name: 'Bug',
      colorHex: '#E5484D',
    });

    expect(response.statusCode).toBe(201);
  });

  it('lists labels for a MEMBER', async () => {
    const fixture = await createWorkspaceFixture(app());
    await createLabel(fixture.id, fixture.owner.auth, { name: 'Bug', colorHex: '#E5484D' });

    const response = await app().inject({
      method: 'GET',
      url: `/api/v1/workspaces/${fixture.id}/labels`,
      headers: fixture.member.auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<unknown[]>()).toHaveLength(1);
  });

  it('lets an ADMIN delete one and denies a MEMBER', async () => {
    const fixture = await createWorkspaceFixture(app());
    const created = await createLabel(fixture.id, fixture.owner.auth, {
      name: 'Temp',
      colorHex: '#123456',
    });
    const labelId = created.json<{ id: string }>().id;

    const denied = await app().inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}`,
      headers: fixture.member.auth,
    });
    const allowed = await app().inject({
      method: 'DELETE',
      url: `/api/v1/labels/${labelId}`,
      headers: fixture.admin.auth,
    });

    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(204);
  });
});
