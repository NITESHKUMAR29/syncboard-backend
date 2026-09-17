import { isRole, type Role } from '../../common/roles.js';
import type { Database } from '../../plugins/prisma.js';

/**
 * Membership lookups.
 *
 * Resources reached by their own id (/tasks/{id}, /comments/{id}) resolve their workspace
 * through a join before any role check (Part B §6).
 */
export interface MembershipRepository {
  findRole(workspaceId: string, userId: string): Promise<Role | null>;
  workspaceIdOfBoard(boardId: string): Promise<string | null>;
  workspaceIdOfTask(taskId: string): Promise<string | null>;
  workspaceIdOfComment(commentId: string): Promise<string | null>;
  workspaceIdOfLabel(labelId: string): Promise<string | null>;
  workspaceIdOfAttachment(attachmentId: string): Promise<string | null>;
}

export function createMembershipRepository(db: Database): MembershipRepository {
  return {
    async findRole(workspaceId, userId) {
      const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });

      if (!membership) return null;

      // The column is a VARCHAR, so an unexpected value is possible in principle; treat
      // it as the least privileged rather than trusting it.
      return isRole(membership.role) ? membership.role : 'MEMBER';
    },

    async workspaceIdOfBoard(boardId) {
      const board = await db.board.findUnique({
        where: { id: boardId },
        select: { workspaceId: true },
      });
      return board?.workspaceId ?? null;
    },

    async workspaceIdOfTask(taskId) {
      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { board: { select: { workspaceId: true } } },
      });
      return task?.board.workspaceId ?? null;
    },

    async workspaceIdOfComment(commentId) {
      const comment = await db.comment.findUnique({
        where: { id: commentId },
        select: { task: { select: { board: { select: { workspaceId: true } } } } },
      });
      return comment?.task.board.workspaceId ?? null;
    },

    async workspaceIdOfLabel(labelId) {
      const label = await db.label.findUnique({
        where: { id: labelId },
        select: { workspaceId: true },
      });
      return label?.workspaceId ?? null;
    },

    async workspaceIdOfAttachment(attachmentId) {
      const attachment = await db.attachment.findUnique({
        where: { id: attachmentId },
        select: { task: { select: { board: { select: { workspaceId: true } } } } },
      });
      return attachment?.task.board.workspaceId ?? null;
    },
  };
}
