import type { FastifyInstance } from 'fastify';
import type { Role } from '../../src/common/roles.js';
import { registerUser, type RegisteredUser } from './factories.js';

/**
 * A workspace with one user per role, which is what the permission matrix needs: every
 * rule gets an allowed case and a denied case.
 */
export interface WorkspaceFixture {
  id: string;
  owner: RegisteredUser;
  admin: RegisteredUser;
  member: RegisteredUser;
  /** Belongs to no workspace, so every request must look like a 404. */
  outsider: RegisteredUser;
}

export async function createWorkspaceFixture(
  app: FastifyInstance,
  name = 'Mobile Team',
): Promise<WorkspaceFixture> {
  const owner = await registerUser(app);
  const admin = await registerUser(app);
  const member = await registerUser(app);
  const outsider = await registerUser(app);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: owner.auth,
    payload: { name },
  });

  if (created.statusCode !== 201) {
    throw new Error(`createWorkspace failed: ${created.body}`);
  }

  const id = created.json<{ id: string }>().id;

  await addMember(app, id, owner, admin.email, 'ADMIN');
  await addMember(app, id, owner, member.email, 'MEMBER');

  return { id, owner, admin, member, outsider };
}

export async function addMember(
  app: FastifyInstance,
  workspaceId: string,
  actor: RegisteredUser,
  email: string,
  role: Role,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/members`,
    headers: actor.auth,
    payload: { email, role },
  });

  if (response.statusCode !== 201) {
    throw new Error(`addMember failed: ${response.body}`);
  }
}
