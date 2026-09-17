import type { Prisma } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';
import type { CommentWithAuthor } from '../comments/comment.mapper.js';
import type { TaskWithRelations } from '../tasks/task.mapper.js';
import type { Board, Label } from '../../generated/prisma/client.js';
import type { MemberWithUser } from '../workspaces/workspace.repository.js';

const TASK_INCLUDE = {
  assignee: true,
  creator: true,
  labels: { include: { label: true } },
  board: { select: { workspaceId: true } },
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: true,
    },
  },
} satisfies Prisma.TaskInclude;

export interface BoardWithCount {
  board: Board;
  taskCount: number;
}

export interface SyncRepository {
  changedBoards(workspaceId: string, since: Date | null, limit: number): Promise<BoardWithCount[]>;
  changedTasks(
    workspaceId: string,
    since: Date | null,
    limit: number,
  ): Promise<TaskWithRelations[]>;
  changedComments(
    workspaceId: string,
    since: Date | null,
    limit: number,
  ): Promise<CommentWithAuthor[]>;
  currentMembers(workspaceId: string): Promise<MemberWithUser[]>;
  currentLabels(workspaceId: string): Promise<Label[]>;
}

export function createSyncRepository(db: Database): SyncRepository {
  /** Deleted rows are included: that is how a client learns to remove them. */
  const updatedSince = (since: Date | null) => (since ? { updatedAt: { gte: since } } : {});

  return {
    async changedBoards(workspaceId, since, limit) {
      const boards = await db.board.findMany({
        where: { workspaceId, ...updatedSince(since) },
        include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });

      return boards.map((board) => ({ board, taskCount: board._count.tasks }));
    },

    changedTasks(workspaceId, since, limit) {
      return db.task.findMany({
        where: { board: { workspaceId }, ...updatedSince(since) },
        include: TASK_INCLUDE,
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
    },

    changedComments(workspaceId, since, limit) {
      return db.comment.findMany({
        where: { task: { board: { workspaceId } }, ...updatedSince(since) },
        include: { author: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
    },

    currentMembers(workspaceId) {
      return db.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: true },
        orderBy: { joinedAt: 'asc' },
      });
    },

    currentLabels(workspaceId) {
      return db.label.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    },
  };
}
