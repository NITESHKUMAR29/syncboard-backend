import type { Prisma } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';
import { recordActivity, type ActivityInput } from '../activity/activity.recorder.js';
import type { FeedCursor } from '../../common/cursor.js';
import type { CommentWithAuthor } from './comment.mapper.js';

export interface CommentRepository {
  findById(id: string): Promise<CommentWithAuthor | null>;
  create(input: {
    id: string;
    taskId: string;
    authorId: string;
    body: string;
    now: Date;
    activity: ActivityInput;
  }): Promise<CommentWithAuthor>;
  updateIfVersionMatches(input: {
    id: string;
    version: number;
    body: string;
    now: Date;
    activity: ActivityInput;
  }): Promise<CommentWithAuthor | null>;
  softDelete(input: { id: string; now: Date; activity: ActivityInput }): Promise<void>;
  /** Oldest first, one past the limit so the caller can tell whether more remain. */
  listByTask(
    taskId: string,
    cursor: FeedCursor | null,
    limit: number,
  ): Promise<CommentWithAuthor[]>;
}

export function createCommentRepository(db: Database): CommentRepository {
  return {
    findById(id) {
      return db.comment.findUnique({ where: { id }, include: { author: true } });
    },

    async create({ id, taskId, authorId, body, now, activity }) {
      return db.$transaction(async (tx) => {
        const comment = await tx.comment.create({
          data: { id, taskId, authorId, body, createdAt: now, updatedAt: now },
          include: { author: true },
        });
        await recordActivity(tx, activity, now);
        return comment;
      });
    },

    async updateIfVersionMatches({ id, version, body, now, activity }) {
      return db.$transaction(async (tx) => {
        const { count } = await tx.comment.updateMany({
          where: { id, version, deletedAt: null },
          data: { body, version: { increment: 1 }, updatedAt: now },
        });

        if (count === 0) return null;

        await recordActivity(tx, activity, now);
        return tx.comment.findUnique({ where: { id }, include: { author: true } });
      });
    },

    async softDelete({ id, now, activity }) {
      await db.$transaction(async (tx) => {
        await tx.comment.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: now, version: { increment: 1 }, updatedAt: now },
        });
        await recordActivity(tx, activity, now);
      });
    },

    listByTask(taskId, cursor, limit) {
      // Keyset pagination on (createdAt, id): stable even when several comments share a
      // timestamp, and unaffected by rows inserted earlier in the feed.
      const after: Prisma.CommentWhereInput | undefined = cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : undefined;

      return db.comment.findMany({
        where: { taskId, deletedAt: null, ...(after ?? {}) },
        include: { author: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
    },
  };
}
