import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import { decodeCursor, encodeCursor } from '../../common/cursor.js';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from '../../common/errors.js';
import type { CursorPage, CursorPaginationQuery } from '../../common/pagination.js';
import { isAtLeast } from '../../common/roles.js';
import { PushType, type PushSender } from '../../push/push-sender.js';
import { ActivityAction, EntityType } from '../activity/activity.recorder.js';
import { EventType, type EventBroadcaster } from '../realtime/events.js';
import type { AccessGuard } from '../workspaces/access.js';
import { toCommentDto, type CommentWithAuthor } from './comment.mapper.js';
import type { CommentRepository } from './comment.repository.js';
import type { CommentDto, CreateCommentBody, UpdateCommentBody } from './comment.schemas.js';
import { findMentionedUserIds } from './mentions.js';

export interface CreatedComment {
  comment: CommentDto;
  created: boolean;
}

export interface TaskContext {
  taskId: string;
  title: string;
  boardId: string;
  workspaceId: string;
  assigneeId: string | null;
  createdBy: string;
  deleted: boolean;
}

export interface CommentService {
  create(taskId: string, userId: string, body: CreateCommentBody): Promise<CreatedComment>;
  list(
    taskId: string,
    userId: string,
    query: CursorPaginationQuery,
  ): Promise<CursorPage<CommentDto>>;
  update(commentId: string, userId: string, body: UpdateCommentBody): Promise<CommentDto>;
  remove(commentId: string, userId: string): Promise<void>;
}

export interface CommentServiceDeps {
  repository: CommentRepository;
  access: AccessGuard;
  clock: Clock;
  events: EventBroadcaster;
  push: PushSender;
  loadTask: (taskId: string) => Promise<TaskContext | null>;
  workspaceIdOfComment: (commentId: string) => Promise<string | null>;
  listMembers: (workspaceId: string) => Promise<{ userId: string; name: string }[]>;
}

export function createCommentService({
  repository,
  access,
  clock,
  events,
  push,
  loadTask,
  workspaceIdOfComment,
  listMembers,
}: CommentServiceDeps): CommentService {
  return {
    async create(taskId, userId, body) {
      const task = await loadTask(taskId);
      if (!task || task.deleted) throw new NotFoundError('Task not found');

      await access.requireMember(task.workspaceId, userId);

      const id = body.id ?? randomUUID();

      if (body.id) {
        // FR-CMT-1: same idempotency rule as tasks. A retried offline comment must not
        // post twice, nor notify twice.
        const existing = await repository.findById(body.id);

        if (existing) {
          if (existing.authorId === userId && existing.taskId === taskId) {
            return { comment: toCommentDto(existing), created: false };
          }
          throw new ValidationError('This id is already in use', { id: 'ID_TAKEN' });
        }
      }

      const now = clock.now();

      const comment = await repository.create({
        id,
        taskId,
        authorId: userId,
        body: body.body,
        now,
        activity: {
          workspaceId: task.workspaceId,
          actorId: userId,
          entityType: EntityType.COMMENT,
          entityId: id,
          action: ActivityAction.CREATED,
          summary: `commented on "${task.title}"`,
        },
      });

      const dto = toCommentDto(comment);

      events.broadcast({
        type: EventType.COMMENT_CREATED,
        workspaceId: task.workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      await notify(task, comment, userId);

      return { comment: dto, created: true };
    },

    async list(taskId, userId, query) {
      const task = await loadTask(taskId);
      if (!task || task.deleted) throw new NotFoundError('Task not found');

      await access.requireMember(task.workspaceId, userId);

      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      if (query.cursor && !cursor) {
        throw new ValidationError('Invalid cursor', { cursor: 'INVALID' });
      }

      // One extra row tells us whether another page exists without a second count query.
      const rows = await repository.listByTask(taskId, cursor, query.limit);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items.at(-1);

      return {
        items: items.map(toCommentDto),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async update(commentId, userId, body) {
      const workspaceId = await workspaceIdOfComment(commentId);
      if (!workspaceId) throw new NotFoundError('Comment not found');

      await access.requireMember(workspaceId, userId);

      const existing = await repository.findById(commentId);
      if (!existing || existing.deletedAt) throw new NotFoundError('Comment not found');

      // FR-CMT-3: editing is the author's alone. An ADMIN may delete a comment but not
      // put words in someone's mouth.
      if (existing.authorId !== userId) {
        throw new ForbiddenError('Only the author can edit this comment');
      }

      const now = clock.now();

      const updated = await repository.updateIfVersionMatches({
        id: commentId,
        version: body.version,
        body: body.body,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.COMMENT,
          entityId: commentId,
          action: ActivityAction.UPDATED,
          summary: 'edited a comment',
        },
      });

      if (!updated) {
        const current = await repository.findById(commentId);
        if (!current || current.deletedAt) throw new NotFoundError('Comment not found');

        throw new VersionConflictError(
          toCommentDto(current),
          'Comment was changed by someone else',
        );
      }

      const dto = toCommentDto(updated);

      events.broadcast({
        type: EventType.COMMENT_UPDATED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      return dto;
    },

    async remove(commentId, userId) {
      const workspaceId = await workspaceIdOfComment(commentId);
      if (!workspaceId) throw new NotFoundError('Comment not found');

      const role = await access.requireMember(workspaceId, userId);

      const existing = await repository.findById(commentId);
      if (!existing || existing.deletedAt) throw new NotFoundError('Comment not found');

      if (existing.authorId !== userId && !isAtLeast(role, 'ADMIN')) {
        throw new ForbiddenError('Only the author or an ADMIN can delete this comment');
      }

      const now = clock.now();

      await repository.softDelete({
        id: commentId,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.COMMENT,
          entityId: commentId,
          action: ActivityAction.DELETED,
          summary: 'deleted a comment',
        },
      });

      events.broadcast({
        type: EventType.COMMENT_DELETED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: { id: commentId, taskId: existing.taskId },
      });
    },
  };

  /**
   * FR-CMT-1: the task's assignee and creator hear about a new comment, and anyone named
   * in it hears about the mention. Nobody is notified twice, and the author is never
   * notified at all (FR-PUSH-1).
   */
  async function notify(task: TaskContext, comment: CommentWithAuthor, actorId: string) {
    const members = await listMembers(task.workspaceId);
    const mentioned = findMentionedUserIds(comment.body, members).filter((id) => id !== actorId);
    const mentionedSet = new Set(mentioned);

    const followers = [task.assigneeId, task.createdBy].filter(
      (id): id is string => id !== null && id !== actorId && !mentionedSet.has(id),
    );

    const deepLink = `taskflow://tasks/${task.taskId}`;
    const context = {
      workspaceId: task.workspaceId,
      boardId: task.boardId,
      taskId: task.taskId,
      deepLink,
    };

    if (mentioned.length > 0) {
      push.send({
        userIds: mentioned,
        data: {
          type: PushType.MENTIONED,
          title: 'You were mentioned',
          body: `${comment.author.name} mentioned you on "${task.title}"`,
          ...context,
        },
      });
    }

    const uniqueFollowers = [...new Set(followers)];
    if (uniqueFollowers.length > 0) {
      push.send({
        userIds: uniqueFollowers,
        data: {
          type: PushType.COMMENT_ADDED,
          title: 'New comment',
          body: `${comment.author.name} commented on "${task.title}"`,
          ...context,
        },
      });
    }
  }
}
