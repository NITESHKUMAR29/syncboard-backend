import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import { fromDateOnly } from '../../common/dates.js';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from '../../common/errors.js';
import { toOffsetPage, type OffsetPage } from '../../common/pagination.js';
import { appendPosition, needsRenumbering, renumber } from '../../common/positions.js';
import { isAtLeast } from '../../common/roles.js';
import { PushType, type PushSender } from '../../push/push-sender.js';
import { ActivityAction, EntityType } from '../activity/activity.recorder.js';
import { EventType, type EventBroadcaster } from '../realtime/events.js';
import type { AccessGuard } from '../workspaces/access.js';
import { toTaskDto, type TaskWithRelations } from './task.mapper.js';
import type { TaskRepository, TaskWriteData } from './task.repository.js';
import type {
  CreateTaskBody,
  ListTasksQuery,
  MyTasksQuery,
  TaskDto,
  UpdateTaskBody,
} from './task.schemas.js';

export interface CreatedTask {
  task: TaskDto;
  /** False when an existing task was returned for a repeated client id (FR-TSK-2). */
  created: boolean;
}

export interface TaskService {
  create(boardId: string, userId: string, body: CreateTaskBody): Promise<CreatedTask>;
  list(boardId: string, userId: string, query: ListTasksQuery): Promise<OffsetPage<TaskDto>>;
  get(taskId: string, userId: string): Promise<TaskDto>;
  update(taskId: string, userId: string, body: UpdateTaskBody): Promise<TaskDto>;
  remove(taskId: string, userId: string): Promise<void>;
  listMine(userId: string, query: MyTasksQuery): Promise<OffsetPage<TaskDto>>;
}

export interface TaskServiceDeps {
  repository: TaskRepository;
  access: AccessGuard;
  clock: Clock;
  events: EventBroadcaster;
  push: PushSender;
  workspaceIdOfBoard: (boardId: string) => Promise<string | null>;
  workspaceIdOfTask: (taskId: string) => Promise<string | null>;
}

export function createTaskService({
  repository,
  access,
  clock,
  events,
  push,
  workspaceIdOfBoard,
  workspaceIdOfTask,
}: TaskServiceDeps): TaskService {
  /** Rejects an assignee who is not in the workspace, and labels from another one. */
  async function validateReferences(
    workspaceId: string,
    assigneeId: string | null | undefined,
    labelIds: string[] | undefined,
  ): Promise<void> {
    if (assigneeId) {
      const isMember = await repository.isWorkspaceMember(workspaceId, assigneeId);
      if (!isMember) {
        throw new ValidationError('Assignee must be a member of this workspace', {
          assigneeId: 'NOT_A_MEMBER',
        });
      }
    }

    if (labelIds && labelIds.length > 0) {
      const unique = [...new Set(labelIds)];
      const found = await repository.countLabelsInWorkspace(workspaceId, unique);
      if (found !== unique.length) {
        throw new ValidationError('Labels must belong to this workspace', {
          labelIds: 'NOT_IN_WORKSPACE',
        });
      }
    }
  }

  /**
   * FR-TSK-7: once neighbours are closer than 0.0001, halving again would exhaust double
   * precision, so the board is spread back out over clean multiples of 1000.
   */
  async function renumberIfNeeded(boardId: string, workspaceId: string, actorId: string) {
    const positions = await repository.positionsInBoard(boardId);

    if (!needsRenumbering(positions.map((row) => row.position))) return;

    const fresh = renumber(positions.length);
    await repository.renumberPositions(
      positions.map((row, index) => ({ id: row.id, position: fresh[index] ?? 0 })),
      clock.now(),
    );

    events.broadcast({
      type: EventType.TASKS_REORDERED,
      workspaceId,
      actorId,
      occurredAt: clock.now().toISOString(),
      payload: { boardId },
    });
  }

  function notifyAssigned(task: TaskWithRelations, actorId: string, actorName: string) {
    if (!task.assigneeId || task.assigneeId === actorId) return;

    push.send({
      userIds: [task.assigneeId],
      data: {
        type: PushType.TASK_ASSIGNED,
        title: 'New task assigned',
        body: `${actorName} assigned you "${task.title}"`,
        workspaceId: task.board.workspaceId,
        boardId: task.boardId,
        taskId: task.id,
        deepLink: `taskflow://tasks/${task.id}`,
      },
    });
  }

  return {
    async create(boardId, userId, body) {
      const workspaceId = await workspaceIdOfBoard(boardId);
      if (!workspaceId) throw new NotFoundError('Board not found');

      await access.requireMember(workspaceId, userId);
      await validateReferences(workspaceId, body.assigneeId, body.labelIds);

      const id = body.id ?? randomUUID();

      if (body.id) {
        // FR-TSK-2: the client retried an offline create. If it already landed, return it
        // unchanged — no duplicate row, no second notification, no second activity entry.
        const existing = await repository.findById(body.id);

        if (existing) {
          if (existing.createdBy === userId && existing.boardId === boardId) {
            return { task: toTaskDto(existing), created: false };
          }

          // Same id, different origin: someone else's task, or the same user's task on
          // another board. Silently returning it would leak data.
          throw new ValidationError('This id is already in use', { id: 'ID_TAKEN' });
        }
      }

      const now = clock.now();
      const position = body.position ?? appendPosition(await repository.maxPosition(boardId));

      const task = await repository.create({
        id,
        boardId,
        createdBy: userId,
        data: {
          title: body.title,
          description: body.description ?? null,
          status: body.status,
          priority: body.priority,
          assigneeId: body.assigneeId ?? null,
          dueDate: body.dueDate ? fromDateOnly(body.dueDate) : null,
          position,
        },
        labelIds: body.labelIds,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.TASK,
          entityId: id,
          action: ActivityAction.CREATED,
          summary: `created task "${body.title}"`,
        },
      });

      const dto = toTaskDto(task);

      events.broadcast({
        type: EventType.TASK_CREATED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      notifyAssigned(task, userId, task.creator.name);
      await renumberIfNeeded(boardId, workspaceId, userId);

      return { task: dto, created: true };
    },

    async list(boardId, userId, query) {
      const workspaceId = await workspaceIdOfBoard(boardId);
      if (!workspaceId) throw new NotFoundError('Board not found');

      await access.requireMember(workspaceId, userId);

      const assigneeId = query.assigneeId === 'me' ? userId : query.assigneeId;
      const { rows, total } = await repository.listByBoard(boardId, query, assigneeId);

      return toOffsetPage(rows.map(toTaskDto), total, query);
    },

    async get(taskId, userId) {
      const workspaceId = await workspaceIdOfTask(taskId);
      if (!workspaceId) throw new NotFoundError('Task not found');

      await access.requireMember(workspaceId, userId);

      const task = await repository.findById(taskId);
      if (!task || task.deletedAt) throw new NotFoundError('Task not found');

      return toTaskDto(task);
    },

    async update(taskId, userId, body) {
      const workspaceId = await workspaceIdOfTask(taskId);
      if (!workspaceId) throw new NotFoundError('Task not found');

      await access.requireMember(workspaceId, userId);

      const before = await repository.findById(taskId);
      if (!before || before.deletedAt) throw new NotFoundError('Task not found');

      const { version, labelIds, boardId, ...rest } = body;

      if (boardId && boardId !== before.boardId) {
        // FR-TSK-4: moving between boards is allowed, but not between workspaces — the
        // task's labels, assignee and permissions all belong to the current one.
        const targetWorkspaceId = await workspaceIdOfBoard(boardId);
        if (!targetWorkspaceId)
          throw new ValidationError('Board not found', { boardId: 'NOT_FOUND' });
        if (targetWorkspaceId !== workspaceId) {
          throw new ValidationError('A task cannot move to another workspace', {
            boardId: 'DIFFERENT_WORKSPACE',
          });
        }
      }

      await validateReferences(workspaceId, rest.assigneeId, labelIds);

      // Absent keys stay undefined and Prisma leaves those columns alone; an explicit
      // null clears the column (Part A, "PATCH null versus absent").
      const data: TaskWriteData = {
        ...(rest.title !== undefined ? { title: rest.title } : {}),
        ...(rest.description !== undefined ? { description: rest.description } : {}),
        ...(rest.status !== undefined ? { status: rest.status } : {}),
        ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
        ...(rest.assigneeId !== undefined ? { assigneeId: rest.assigneeId } : {}),
        ...(rest.dueDate !== undefined
          ? { dueDate: rest.dueDate === null ? null : fromDateOnly(rest.dueDate) }
          : {}),
        ...(rest.position !== undefined ? { position: rest.position } : {}),
        ...(boardId !== undefined ? { boardId } : {}),
      };

      const now = clock.now();

      const updated = await repository.updateIfVersionMatches({
        id: taskId,
        version,
        data,
        ...(labelIds !== undefined ? { labelIds } : {}),
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.TASK,
          entityId: taskId,
          action: describeAction(body, before.boardId),
          summary: describeTaskUpdate(body, before.title, before.boardId),
        },
      });

      if (!updated) {
        const current = await repository.findById(taskId);
        // A deleted task cannot be edited, and that is not a conflict to resolve: there
        // is nothing left to merge into (Part B §7.2).
        if (!current || current.deletedAt) throw new NotFoundError('Task not found');

        throw new VersionConflictError(toTaskDto(current), 'Task was changed by someone else');
      }

      const dto = toTaskDto(updated);

      events.broadcast({
        type: EventType.TASK_UPDATED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      // Only notify when the assignee actually changed, not on every edit.
      if (rest.assigneeId !== undefined && rest.assigneeId !== before.assigneeId) {
        notifyAssigned(updated, userId, updated.creator.name);
      }

      await renumberIfNeeded(updated.boardId, workspaceId, userId);

      return dto;
    },

    async remove(taskId, userId) {
      const workspaceId = await workspaceIdOfTask(taskId);
      if (!workspaceId) throw new NotFoundError('Task not found');

      const role = await access.requireMember(workspaceId, userId);

      const task = await repository.findRaw(taskId);
      if (!task || task.deletedAt) throw new NotFoundError('Task not found');

      // FR-TSK-6: a MEMBER may delete only their own tasks; ADMIN and OWNER may delete any.
      if (task.createdBy !== userId && !isAtLeast(role, 'ADMIN')) {
        throw new ForbiddenError('Only the task creator or an ADMIN can delete this task');
      }

      const now = clock.now();

      await repository.softDelete({
        id: taskId,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.TASK,
          entityId: taskId,
          action: ActivityAction.DELETED,
          summary: `deleted task "${task.title}"`,
        },
      });

      events.broadcast({
        type: EventType.TASK_DELETED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: { id: taskId, boardId: task.boardId },
      });
    },

    async listMine(userId, query) {
      const { rows, total } = await repository.listAssignedTo(userId, query);
      return toOffsetPage(rows.map(toTaskDto), total, query);
    },
  };
}

function describeAction(body: UpdateTaskBody, previousBoardId: string) {
  if (body.boardId !== undefined && body.boardId !== previousBoardId) {
    return ActivityAction.MOVED;
  }
  if (body.assigneeId !== undefined) return ActivityAction.ASSIGNED;
  if (body.status !== undefined) return ActivityAction.MOVED;
  return ActivityAction.UPDATED;
}

/** Written at edit time, describing this change rather than the task's final state. */
function describeTaskUpdate(body: UpdateTaskBody, title: string, previousBoardId: string): string {
  if (body.boardId !== undefined && body.boardId !== previousBoardId) {
    return `moved "${title}" to another board`;
  }
  if (body.status !== undefined) {
    return `moved "${title}" to ${humanizeStatus(body.status)}`;
  }
  if (body.assigneeId === null) return `unassigned "${title}"`;
  if (body.assigneeId !== undefined) return `assigned "${title}"`;
  if (body.priority !== undefined) return `set "${title}" to ${body.priority} priority`;
  if (body.title !== undefined) return `renamed "${title}" to "${body.title}"`;
  return `updated "${title}"`;
}

function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
