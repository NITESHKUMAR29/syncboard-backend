import type { Board } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';
import { recordActivity, type ActivityInput } from '../activity/activity.recorder.js';

export interface BoardWithCount {
  board: Board;
  taskCount: number;
}

export interface BoardRepository {
  create(input: {
    id: string;
    workspaceId: string;
    title: string;
    position: number;
    now: Date;
    activity: ActivityInput;
  }): Promise<Board>;

  findById(id: string): Promise<Board | null>;
  findWithCount(id: string): Promise<BoardWithCount | null>;
  maxPosition(workspaceId: string): Promise<number | null>;
  listByWorkspace(workspaceId: string, includeArchived: boolean): Promise<BoardWithCount[]>;

  /** Conditional update on (id, version): returns null when the version was stale. */
  updateIfVersionMatches(input: {
    id: string;
    version: number;
    data: { title?: string; position?: number; archived?: boolean };
    now: Date;
    activity: ActivityInput;
  }): Promise<Board | null>;

  softDeleteWithTasks(input: { id: string; now: Date; activity: ActivityInput }): Promise<void>;
}

export function createBoardRepository(db: Database): BoardRepository {
  return {
    async create({ id, workspaceId, title, position, now, activity }) {
      return db.$transaction(async (tx) => {
        const board = await tx.board.create({
          data: { id, workspaceId, title, position, createdAt: now, updatedAt: now },
        });
        await tx.workspace.update({ where: { id: workspaceId }, data: { updatedAt: now } });
        await recordActivity(tx, activity, now);
        return board;
      });
    },

    findById(id) {
      return db.board.findUnique({ where: { id } });
    },

    async findWithCount(id) {
      const board = await db.board.findUnique({
        where: { id },
        include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
      });

      return board ? { board, taskCount: board._count.tasks } : null;
    },

    async maxPosition(workspaceId) {
      const result = await db.board.aggregate({
        where: { workspaceId, deletedAt: null },
        _max: { position: true },
      });
      return result._max.position;
    },

    async listByWorkspace(workspaceId, includeArchived) {
      const boards = await db.board.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          // FR-BRD-2: archived boards are hidden unless explicitly asked for.
          ...(includeArchived ? {} : { archived: false }),
        },
        include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
        orderBy: { position: 'asc' },
      });

      return boards.map((board) => ({ board, taskCount: board._count.tasks }));
    },

    async updateIfVersionMatches({ id, version, data, now, activity }) {
      return db.$transaction(async (tx) => {
        // One conditional update: if another device already bumped the version, count is
        // 0 and nothing was written (Part B §7.2). Reading first would race.
        const { count } = await tx.board.updateMany({
          where: { id, version, deletedAt: null },
          data: { ...data, version: { increment: 1 }, updatedAt: now },
        });

        if (count === 0) return null;

        await recordActivity(tx, activity, now);
        return tx.board.findUnique({ where: { id } });
      });
    },

    async softDeleteWithTasks({ id, now, activity }) {
      await db.$transaction(async (tx) => {
        // FR-BRD-4: the board and every task on it get deletedAt, a bumped version and a
        // new updatedAt, so /sync reports all of them to offline clients.
        await tx.task.updateMany({
          where: { boardId: id, deletedAt: null },
          data: { deletedAt: now, version: { increment: 1 }, updatedAt: now },
        });

        await tx.board.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: now, version: { increment: 1 }, updatedAt: now },
        });

        await recordActivity(tx, activity, now);
      });
    },
  };
}
