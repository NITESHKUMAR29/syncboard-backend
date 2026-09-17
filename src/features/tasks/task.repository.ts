import { Prisma } from '../../generated/prisma/client.js';
import type { Task } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';
import { recordActivity, type ActivityInput } from '../activity/activity.recorder.js';
import type { TaskWithRelations } from './task.mapper.js';
import type { ListTasksQuery, MyTasksQuery } from './task.schemas.js';

/** Everything toTaskDto needs, in one include. */
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

export interface TaskWriteData {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: Date | null;
  position?: number;
  boardId?: string;
}

export interface TaskRepository {
  findById(id: string): Promise<TaskWithRelations | null>;
  findRaw(id: string): Promise<Task | null>;
  maxPosition(boardId: string): Promise<number | null>;

  create(input: {
    id: string;
    boardId: string;
    createdBy: string;
    data: Required<Pick<TaskWriteData, 'title' | 'status' | 'priority' | 'position'>> &
      TaskWriteData;
    labelIds: string[];
    now: Date;
    activity: ActivityInput;
  }): Promise<TaskWithRelations>;

  updateIfVersionMatches(input: {
    id: string;
    version: number;
    data: TaskWriteData;
    labelIds?: string[];
    now: Date;
    activity: ActivityInput;
  }): Promise<TaskWithRelations | null>;

  softDelete(input: { id: string; now: Date; activity: ActivityInput }): Promise<void>;

  listByBoard(
    boardId: string,
    query: ListTasksQuery,
    assigneeId: string | undefined,
  ): Promise<{ rows: TaskWithRelations[]; total: number }>;

  listAssignedTo(
    userId: string,
    query: MyTasksQuery,
  ): Promise<{ rows: TaskWithRelations[]; total: number }>;

  positionsInBoard(boardId: string): Promise<{ id: string; position: number }[]>;
  renumberPositions(updates: { id: string; position: number }[], now: Date): Promise<void>;

  countLabelsInWorkspace(workspaceId: string, labelIds: string[]): Promise<number>;
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
}

export function createTaskRepository(db: Database): TaskRepository {
  return {
    findById(id) {
      return db.task.findUnique({ where: { id }, include: TASK_INCLUDE });
    },

    findRaw(id) {
      return db.task.findUnique({ where: { id } });
    },

    async maxPosition(boardId) {
      const result = await db.task.aggregate({
        where: { boardId, deletedAt: null },
        _max: { position: true },
      });
      return result._max.position;
    },

    async create({ id, boardId, createdBy, data, labelIds, now, activity }) {
      return db.$transaction(async (tx) => {
        await tx.task.create({
          data: {
            id,
            boardId,
            createdBy,
            title: data.title,
            description: data.description ?? null,
            status: data.status,
            priority: data.priority,
            assigneeId: data.assigneeId ?? null,
            dueDate: data.dueDate ?? null,
            position: data.position,
            createdAt: now,
            updatedAt: now,
          },
        });

        if (labelIds.length > 0) {
          await tx.taskLabel.createMany({
            data: labelIds.map((labelId) => ({ taskId: id, labelId })),
          });
        }

        await recordActivity(tx, activity, now);

        return tx.task.findUniqueOrThrow({ where: { id }, include: TASK_INCLUDE });
      });
    },

    async updateIfVersionMatches({ id, version, data, labelIds, now, activity }) {
      return db.$transaction(async (tx) => {
        // Conditional on (id, version, not deleted): count 0 means someone else won.
        const { count } = await tx.task.updateMany({
          where: { id, version, deletedAt: null },
          data: { ...data, version: { increment: 1 }, updatedAt: now },
        });

        if (count === 0) return null;

        // Labels are a set, so an explicit list replaces whatever was there.
        if (labelIds) {
          await tx.taskLabel.deleteMany({ where: { taskId: id } });
          if (labelIds.length > 0) {
            await tx.taskLabel.createMany({
              data: labelIds.map((labelId) => ({ taskId: id, labelId })),
            });
          }
        }

        await recordActivity(tx, activity, now);

        return tx.task.findUnique({ where: { id }, include: TASK_INCLUDE });
      });
    },

    async softDelete({ id, now, activity }) {
      await db.$transaction(async (tx) => {
        // FR-TSK-6: no version required, delete wins (Part B §7.2).
        await tx.task.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: now, version: { increment: 1 }, updatedAt: now },
        });
        await recordActivity(tx, activity, now);
      });
    },

    async listByBoard(boardId, query, assigneeId) {
      const where: Prisma.TaskWhereInput = {
        boardId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      };

      const total = await db.task.count({ where });

      if (query.sort === 'priority') {
        const rows = await listBoardTasksByPriority(db, boardId, query, assigneeId);
        return { rows, total };
      }

      const rows = await db.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: toOrderBy(query.sort),
        skip: (query.page - 1) * query.size,
        take: query.size,
      });

      return { rows, total };
    },

    async listAssignedTo(userId, query) {
      // FR-TSK-8: only workspaces the caller still belongs to. Losing membership must
      // make their tasks there disappear from this list.
      const where: Prisma.TaskWhereInput = {
        assigneeId: userId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        board: {
          deletedAt: null,
          workspace: { members: { some: { userId } } },
        },
      };

      const [rows, total] = await Promise.all([
        db.task.findMany({
          where,
          include: TASK_INCLUDE,
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          skip: (query.page - 1) * query.size,
          take: query.size,
        }),
        db.task.count({ where }),
      ]);

      return { rows, total };
    },

    positionsInBoard(boardId) {
      return db.task.findMany({
        where: { boardId, deletedAt: null },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
    },

    async renumberPositions(updates, now) {
      if (updates.length === 0) return;

      await db.$transaction(
        updates.map((update) =>
          db.task.update({
            where: { id: update.id },
            // Renumbering is bookkeeping, not an edit: the version is untouched so it
            // cannot cause spurious conflicts on a client mid-edit.
            data: { position: update.position, updatedAt: now },
          }),
        ),
      );
    },

    countLabelsInWorkspace(workspaceId, labelIds) {
      return db.label.count({ where: { workspaceId, id: { in: labelIds } } });
    },

    async isWorkspaceMember(workspaceId, userId) {
      const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { userId: true },
      });
      return membership !== null;
    },
  };
}

/**
 * Sorting by priority cannot be expressed in Prisma's orderBy: the column is a VARCHAR,
 * so ordering it alphabetically reads HIGH, LOW, MEDIUM, URGENT. This ranks the values in
 * SQL instead, pages over the ranked ids, then loads those rows and restores the order.
 *
 * Every value is a bound parameter (NFR-4): nothing is concatenated into the statement.
 */
async function listBoardTasksByPriority(
  db: Database,
  boardId: string,
  query: ListTasksQuery,
  assigneeId: string | undefined,
): Promise<TaskWithRelations[]> {
  const filters: Prisma.Sql[] = [
    Prisma.sql`board_id = ${boardId}::uuid`,
    Prisma.sql`deleted_at IS NULL`,
  ];

  if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
  if (query.priority) filters.push(Prisma.sql`priority = ${query.priority}`);
  if (assigneeId) filters.push(Prisma.sql`assignee_id = ${assigneeId}::uuid`);

  const ordered = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM tasks
    WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY
      CASE priority
        WHEN 'URGENT' THEN 4
        WHEN 'HIGH' THEN 3
        WHEN 'MEDIUM' THEN 2
        ELSE 1
      END DESC,
      position ASC
    LIMIT ${query.size} OFFSET ${(query.page - 1) * query.size}
  `;

  const ids = ordered.map((row) => row.id);
  if (ids.length === 0) return [];

  const rows = await db.task.findMany({ where: { id: { in: ids } }, include: TASK_INCLUDE });

  // findMany returns them in its own order, so restore the ranking.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Part B §5.1 sort values. A leading `-` means descending. */
function toOrderBy(sort: ListTasksQuery['sort']): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case 'dueDate':
      // Tasks with no due date sort last rather than first.
      return [{ dueDate: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }];
    case '-updatedAt':
      return [{ updatedAt: 'desc' }];
    case 'position':
    default:
      return [{ position: 'asc' }];
  }
}
