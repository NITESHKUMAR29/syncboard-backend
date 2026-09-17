import type { FeedCursor } from '../../common/cursor.js';
import type { ActivityLog, Prisma, User } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';

export type ActivityWithActor = ActivityLog & { actor: User };

export interface ActivityRepository {
  /** Newest first, one past the limit so the caller can tell whether more remain. */
  listByWorkspace(
    workspaceId: string,
    cursor: FeedCursor | null,
    limit: number,
  ): Promise<ActivityWithActor[]>;
}

export function createActivityRepository(db: Database): ActivityRepository {
  return {
    listByWorkspace(workspaceId, cursor, limit) {
      // Keyset pagination on (createdAt, id), descending because the feed is newest first.
      const before: Prisma.ActivityLogWhereInput | undefined = cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : undefined;

      return db.activityLog.findMany({
        where: { workspaceId, ...(before ?? {}) },
        include: { actor: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    },
  };
}
