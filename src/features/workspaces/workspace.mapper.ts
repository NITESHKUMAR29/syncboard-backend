import type { Role } from '../../common/roles.js';
import { isRole } from '../../common/roles.js';
import type { Label, User, Workspace, WorkspaceMember } from '../../generated/prisma/client.js';
import { toUserDto } from '../users/user.mapper.js';
import type { LabelDto, MemberDto, WorkspaceDto } from './workspace.schemas.js';

export function toWorkspaceDto(
  workspace: Workspace,
  myRole: Role,
  memberCount: number,
): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    myRole,
    memberCount,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function toMemberDto(membership: WorkspaceMember & { user: User }): MemberDto {
  return {
    user: toUserDto(membership.user),
    role: isRole(membership.role) ? membership.role : 'MEMBER',
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export function toLabelDto(label: Label): LabelDto {
  return {
    id: label.id,
    name: label.name,
    colorHex: label.colorHex,
  };
}
