import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { isAtLeast, type Role } from '../../common/roles.js';
import type { MembershipRepository } from './membership.repository.js';

/**
 * The single permission helper every service calls first (Part B §6).
 *
 * The distinction that matters: a non-member gets 404, not 403, so workspace ids cannot
 * be probed by watching which ones come back "forbidden". A member who simply lacks the
 * rank gets 403, because they already know the workspace exists.
 */
export interface AccessGuard {
  /** Throws 404 unless the caller belongs to the workspace. Returns their role. */
  requireMember(workspaceId: string, userId: string): Promise<Role>;
  /** Throws 404 for non-members and 403 for members below `minimum`. */
  requireRole(workspaceId: string, userId: string, minimum: Role): Promise<Role>;
  /** The caller's role, or null when they are not a member. */
  roleOf(workspaceId: string, userId: string): Promise<Role | null>;
}

export function createAccessGuard(repository: MembershipRepository): AccessGuard {
  async function requireMember(workspaceId: string, userId: string): Promise<Role> {
    const role = await repository.findRole(workspaceId, userId);

    if (!role) {
      throw new NotFoundError('Workspace not found');
    }

    return role;
  }

  return {
    requireMember,

    async requireRole(workspaceId, userId, minimum) {
      const role = await requireMember(workspaceId, userId);

      if (!isAtLeast(role, minimum)) {
        throw new ForbiddenError(`This action requires the ${minimum} role`);
      }

      return role;
    },

    roleOf(workspaceId, userId) {
      return repository.findRole(workspaceId, userId);
    },
  };
}
