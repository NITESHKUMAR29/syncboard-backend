import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import {
  AlreadyMemberError,
  ForbiddenError,
  LastOwnerError,
  NotFoundError,
  ValidationError,
} from '../../common/errors.js';
import {
  toOffsetPage,
  toSkip,
  type OffsetPage,
  type OffsetPaginationQuery,
} from '../../common/pagination.js';
import { isAtLeast, rankOf, type Role } from '../../common/roles.js';
import { ActivityAction, EntityType } from '../activity/activity.recorder.js';
import { CloseCode, EventType, type EventBroadcaster } from '../realtime/events.js';
import { PushType, type PushSender } from '../../push/push-sender.js';
import type { AccessGuard } from './access.js';
import { toLabelDto, toMemberDto, toWorkspaceDto } from './workspace.mapper.js';
import type { WorkspaceRepository } from './workspace.repository.js';
import type {
  AddMemberBody,
  ChangeRoleBody,
  CreateLabelBody,
  CreateWorkspaceBody,
  LabelDto,
  MemberDto,
  RenameWorkspaceBody,
  WorkspaceDto,
} from './workspace.schemas.js';

export interface WorkspaceService {
  create(userId: string, body: CreateWorkspaceBody): Promise<WorkspaceDto>;
  list(userId: string, query: OffsetPaginationQuery): Promise<OffsetPage<WorkspaceDto>>;
  get(workspaceId: string, userId: string): Promise<WorkspaceDto>;
  rename(workspaceId: string, userId: string, body: RenameWorkspaceBody): Promise<WorkspaceDto>;
  remove(workspaceId: string, userId: string): Promise<void>;

  listMembers(workspaceId: string, userId: string): Promise<MemberDto[]>;
  addMember(workspaceId: string, userId: string, body: AddMemberBody): Promise<MemberDto>;
  changeMemberRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    body: ChangeRoleBody,
  ): Promise<MemberDto>;
  removeMember(workspaceId: string, actorId: string, targetUserId: string): Promise<void>;

  listLabels(workspaceId: string, userId: string): Promise<LabelDto[]>;
  createLabel(workspaceId: string, userId: string, body: CreateLabelBody): Promise<LabelDto>;
  deleteLabel(labelId: string, userId: string): Promise<void>;
}

export interface WorkspaceServiceDeps {
  repository: WorkspaceRepository;
  access: AccessGuard;
  clock: Clock;
  events: EventBroadcaster;
  push: PushSender;
  /** Resolves a label's workspace, since /labels/{id} carries no workspace in its path. */
  workspaceIdOfLabel: (labelId: string) => Promise<string | null>;
}

export function createWorkspaceService({
  repository,
  access,
  clock,
  events,
  push,
  workspaceIdOfLabel,
}: WorkspaceServiceDeps): WorkspaceService {
  /** Loads the DTO after a change, so responses always carry a fresh memberCount. */
  async function toDto(workspaceId: string, myRole: Role): Promise<WorkspaceDto> {
    const [workspace, memberCount] = await Promise.all([
      repository.findById(workspaceId),
      repository.countMembers(workspaceId),
    ]);

    if (!workspace) throw new NotFoundError('Workspace not found');

    return toWorkspaceDto(workspace, myRole, memberCount);
  }

  return {
    async create(userId, body) {
      const id = randomUUID();
      const now = clock.now();

      await repository.createWithOwner({
        id,
        name: body.name,
        ownerId: userId,
        now,
        activity: {
          workspaceId: id,
          actorId: userId,
          entityType: EntityType.MEMBER,
          entityId: userId,
          action: ActivityAction.CREATED,
          summary: `created workspace "${body.name}"`,
        },
      });

      return toDto(id, 'OWNER');
    },

    async list(userId, query) {
      const { rows, total } = await repository.listForUser(userId, toSkip(query), query.size);

      const items = rows.map((row) => toWorkspaceDto(row.workspace, row.myRole, row.memberCount));

      return toOffsetPage(items, total, query);
    },

    async get(workspaceId, userId) {
      const role = await access.requireMember(workspaceId, userId);
      return toDto(workspaceId, role);
    },

    async rename(workspaceId, userId, body) {
      const role = await access.requireRole(workspaceId, userId, 'ADMIN');
      const now = clock.now();

      await repository.rename(workspaceId, body.name, now, {
        workspaceId,
        actorId: userId,
        entityType: EntityType.MEMBER,
        entityId: workspaceId,
        action: ActivityAction.UPDATED,
        summary: `renamed the workspace to "${body.name}"`,
      });

      return toDto(workspaceId, role);
    },

    async remove(workspaceId, userId) {
      await access.requireRole(workspaceId, userId, 'OWNER');
      await repository.delete(workspaceId);

      // FR-WS-3: the workspace is gone, so every client watching it is told to stop.
      events.closeWorkspaceSockets(workspaceId, CloseCode.WORKSPACE_GONE);
    },

    async listMembers(workspaceId, userId) {
      await access.requireMember(workspaceId, userId);
      const members = await repository.listMembers(workspaceId);
      return members.map(toMemberDto);
    },

    async addMember(workspaceId, actorId, body) {
      const actorRole = await access.requireRole(workspaceId, actorId, 'ADMIN');

      // FR-MEM-1: ADMINs may not mint OWNERs, or they could promote themselves.
      if (body.role === 'OWNER' && actorRole !== 'OWNER') {
        throw new ForbiddenError('Only an OWNER can add another OWNER');
      }

      // A9: no invite emails in v1, so the account must already exist.
      const user = await repository.findUserByEmail(body.email);
      if (!user) throw new NotFoundError('No account exists with this email');

      const existing = await repository.findMember(workspaceId, user.id);
      if (existing) throw new AlreadyMemberError();

      const now = clock.now();
      const workspace = await repository.findById(workspaceId);

      const member = await repository.addMember({
        workspaceId,
        userId: user.id,
        role: body.role,
        now,
        activity: {
          workspaceId,
          actorId,
          entityType: EntityType.MEMBER,
          entityId: user.id,
          action: ActivityAction.CREATED,
          summary: `added ${user.name} to the workspace`,
        },
      });

      const dto = toMemberDto(member);

      events.broadcast({
        type: EventType.MEMBER_ADDED,
        workspaceId,
        actorId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      push.send({
        userIds: [user.id],
        data: {
          type: PushType.WORKSPACE_INVITE,
          title: 'Added to a workspace',
          body: `You were added to "${workspace?.name ?? 'a workspace'}"`,
          workspaceId,
          deepLink: `taskflow://workspaces/${workspaceId}`,
        },
      });

      return dto;
    },

    async changeMemberRole(workspaceId, actorId, targetUserId, body) {
      await access.requireRole(workspaceId, actorId, 'OWNER');

      const target = await repository.findMember(workspaceId, targetUserId);
      if (!target) throw new NotFoundError('Member not found');

      const currentRole = target.role as Role;

      if (currentRole === body.role) {
        // Nothing to do, but still report the current state.
        return toMemberDto(target);
      }

      // FR-MEM-2: a workspace always has at least one OWNER, so the last one cannot be
      // demoted — there would be nobody left who can delete it or change roles.
      if (currentRole === 'OWNER' && body.role !== 'OWNER') {
        const owners = await repository.countOwners(workspaceId);
        if (owners <= 1) throw new LastOwnerError();
      }

      const now = clock.now();
      const member = await repository.changeMemberRole({
        workspaceId,
        userId: targetUserId,
        role: body.role,
        now,
        activity: {
          workspaceId,
          actorId,
          entityType: EntityType.MEMBER,
          entityId: targetUserId,
          action: ActivityAction.UPDATED,
          summary: `changed ${target.user.name}'s role to ${body.role}`,
        },
      });

      const dto = toMemberDto(member);

      events.broadcast({
        type: EventType.MEMBER_UPDATED,
        workspaceId,
        actorId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      return dto;
    },

    async removeMember(workspaceId, actorId, targetUserId) {
      const actorRole = await access.requireMember(workspaceId, actorId);
      const leaving = targetUserId === actorId;

      const target = await repository.findMember(workspaceId, targetUserId);
      if (!target) throw new NotFoundError('Member not found');

      const targetRole = target.role as Role;

      if (!leaving) {
        // FR-MEM-3: removing someone needs ADMIN, and outranking them.
        if (!isAtLeast(actorRole, 'ADMIN')) {
          throw new ForbiddenError('This action requires the ADMIN role');
        }
        if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
          throw new ForbiddenError('Only an OWNER can remove another OWNER');
        }
        if (rankOf(targetRole) > rankOf(actorRole)) {
          throw new ForbiddenError('You cannot remove a member who outranks you');
        }
      }

      // Applies to leaving and to being removed: the workspace must keep an OWNER.
      if (targetRole === 'OWNER') {
        const owners = await repository.countOwners(workspaceId);
        if (owners <= 1) throw new LastOwnerError();
      }

      const now = clock.now();
      await repository.removeMember({
        workspaceId,
        userId: targetUserId,
        now,
        activity: {
          workspaceId,
          actorId,
          entityType: EntityType.MEMBER,
          entityId: targetUserId,
          action: ActivityAction.DELETED,
          summary: leaving
            ? `${target.user.name} left the workspace`
            : `removed ${target.user.name} from the workspace`,
        },
      });

      events.broadcast({
        type: EventType.MEMBER_REMOVED,
        workspaceId,
        actorId,
        occurredAt: now.toISOString(),
        payload: { userId: targetUserId },
      });

      // FR-RT-3: they can no longer see this workspace, so their sockets close.
      events.closeUserSockets(workspaceId, targetUserId, CloseCode.NOT_A_MEMBER);
    },

    async listLabels(workspaceId, userId) {
      await access.requireMember(workspaceId, userId);
      const labels = await repository.listLabels(workspaceId);
      return labels.map(toLabelDto);
    },

    async createLabel(workspaceId, userId, body) {
      await access.requireRole(workspaceId, userId, 'ADMIN');

      // FR-LBL-1: unique per workspace, compared case-insensitively. The database has a
      // matching index; this check is what turns the collision into a 400 with a field.
      const existing = await repository.findLabelByNameInsensitive(workspaceId, body.name);
      if (existing) {
        throw new ValidationError('A label with this name already exists', {
          name: 'ALREADY_EXISTS',
        });
      }

      const label = await repository.createLabel({
        id: randomUUID(),
        workspaceId,
        name: body.name,
        colorHex: body.colorHex.toUpperCase(),
      });

      return toLabelDto(label);
    },

    async deleteLabel(labelId, userId) {
      const workspaceId = await workspaceIdOfLabel(labelId);
      if (!workspaceId) throw new NotFoundError('Label not found');

      await access.requireRole(workspaceId, userId, 'ADMIN');
      await repository.deleteLabel(labelId);
    },
  };
}
