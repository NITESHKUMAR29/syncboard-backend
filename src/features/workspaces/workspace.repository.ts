import type { Role } from '../../common/roles.js';
import type { Label, User, Workspace, WorkspaceMember } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';
import { recordActivity, type ActivityInput } from '../activity/activity.recorder.js';

export type MemberWithUser = WorkspaceMember & { user: User };

export interface WorkspaceWithCount {
  workspace: Workspace;
  memberCount: number;
  myRole: Role;
}

export interface WorkspaceRepository {
  createWithOwner(input: {
    id: string;
    name: string;
    ownerId: string;
    now: Date;
    activity: ActivityInput;
  }): Promise<Workspace>;

  findById(id: string): Promise<Workspace | null>;
  countMembers(workspaceId: string): Promise<number>;
  listForUser(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ rows: WorkspaceWithCount[]; total: number }>;
  rename(id: string, name: string, now: Date, activity: ActivityInput): Promise<Workspace>;
  delete(id: string): Promise<void>;

  listMembers(workspaceId: string): Promise<MemberWithUser[]>;
  findMember(workspaceId: string, userId: string): Promise<MemberWithUser | null>;
  countOwners(workspaceId: string): Promise<number>;
  addMember(input: {
    workspaceId: string;
    userId: string;
    role: Role;
    now: Date;
    activity: ActivityInput;
  }): Promise<MemberWithUser>;
  changeMemberRole(input: {
    workspaceId: string;
    userId: string;
    role: Role;
    now: Date;
    activity: ActivityInput;
  }): Promise<MemberWithUser>;
  removeMember(input: {
    workspaceId: string;
    userId: string;
    now: Date;
    activity: ActivityInput;
  }): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;

  listLabels(workspaceId: string): Promise<Label[]>;
  createLabel(input: {
    id: string;
    workspaceId: string;
    name: string;
    colorHex: string;
  }): Promise<Label>;
  findLabelByNameInsensitive(workspaceId: string, name: string): Promise<Label | null>;
  deleteLabel(id: string): Promise<void>;
}

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
  return {
    async createWithOwner({ id, name, ownerId, now, activity }) {
      // FR-WS-1: the workspace and its owner membership are one unit. A workspace with no
      // OWNER would be unmanageable, so they commit together (NFR-6).
      return db.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { id, name, ownerId, createdAt: now, updatedAt: now },
        });

        await tx.workspaceMember.create({
          data: { workspaceId: id, userId: ownerId, role: 'OWNER', joinedAt: now },
        });

        await recordActivity(tx, activity, now);

        return workspace;
      });
    },

    findById(id) {
      return db.workspace.findUnique({ where: { id } });
    },

    countMembers(workspaceId) {
      return db.workspaceMember.count({ where: { workspaceId } });
    },

    async listForUser(userId, skip, take) {
      // FR-WS-2: only workspaces the caller belongs to, newest activity first.
      const [memberships, total] = await Promise.all([
        db.workspaceMember.findMany({
          where: { userId },
          include: { workspace: { include: { _count: { select: { members: true } } } } },
          orderBy: { workspace: { updatedAt: 'desc' } },
          skip,
          take,
        }),
        db.workspaceMember.count({ where: { userId } }),
      ]);

      const rows = memberships.map((membership) => ({
        workspace: membership.workspace,
        memberCount: membership.workspace._count.members,
        myRole: membership.role as Role,
      }));

      return { rows, total };
    },

    async rename(id, name, now, activity) {
      return db.$transaction(async (tx) => {
        const workspace = await tx.workspace.update({
          where: { id },
          data: { name, updatedAt: now },
        });
        await recordActivity(tx, activity, now);
        return workspace;
      });
    },

    async delete(id) {
      // A9: hard delete with cascade. Boards, tasks, comments, labels, members and
      // activity all hang off the workspace with ON DELETE CASCADE.
      await db.workspace.delete({ where: { id } });
    },

    listMembers(workspaceId) {
      return db.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: true },
        orderBy: { joinedAt: 'asc' },
      });
    },

    findMember(workspaceId, userId) {
      return db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        include: { user: true },
      });
    },

    countOwners(workspaceId) {
      return db.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
    },

    async addMember({ workspaceId, userId, role, now, activity }) {
      return db.$transaction(async (tx) => {
        const member = await tx.workspaceMember.create({
          data: { workspaceId, userId, role, joinedAt: now },
          include: { user: true },
        });
        // Membership changes move the workspace up the caller's list.
        await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: now } });
        await recordActivity(tx, activity, now);
        return member;
      });
    },

    async changeMemberRole({ workspaceId, userId, role, now, activity }) {
      return db.$transaction(async (tx) => {
        const member = await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role },
          include: { user: true },
        });
        await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: now } });
        await recordActivity(tx, activity, now);
        return member;
      });
    },

    async removeMember({ workspaceId, userId, now, activity }) {
      await db.$transaction(async (tx) => {
        await tx.workspaceMember.delete({
          where: { workspaceId_userId: { workspaceId, userId } },
        });
        await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: now } });
        await recordActivity(tx, activity, now);
      });
    },

    findUserByEmail(email) {
      return db.user.findUnique({ where: { email } });
    },

    listLabels(workspaceId) {
      return db.label.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    },

    createLabel({ id, workspaceId, name, colorHex }) {
      return db.label.create({ data: { id, workspaceId, name, colorHex } });
    },

    async findLabelByNameInsensitive(workspaceId, name) {
      const [label] = await db.label.findMany({
        where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
        take: 1,
      });
      return label ?? null;
    },

    async deleteLabel(id) {
      await db.label.delete({ where: { id } });
    },
  };
}
