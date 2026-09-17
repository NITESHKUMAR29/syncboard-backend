import { decodeCursor, encodeCursor } from '../../common/cursor.js';
import { ValidationError } from '../../common/errors.js';
import type { CursorPage, CursorPaginationQuery } from '../../common/pagination.js';
import { toUserSummaryDto } from '../users/user.mapper.js';
import type { AccessGuard } from '../workspaces/access.js';
import type { ActivityRepository, ActivityWithActor } from './activity.repository.js';
import type { ActivityDto } from './activity.schemas.js';

export interface ActivityService {
  list(
    workspaceId: string,
    userId: string,
    query: CursorPaginationQuery,
  ): Promise<CursorPage<ActivityDto>>;
}

export function createActivityService(
  repository: ActivityRepository,
  access: AccessGuard,
): ActivityService {
  return {
    async list(workspaceId, userId, query) {
      await access.requireMember(workspaceId, userId);

      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      if (query.cursor && !cursor) {
        throw new ValidationError('Invalid cursor', { cursor: 'INVALID' });
      }

      const rows = await repository.listByWorkspace(workspaceId, cursor, query.limit);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items.at(-1);

      return {
        items: items.map(toActivityDto),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
  };
}

function toActivityDto(row: ActivityWithActor): ActivityDto {
  return {
    id: row.id,
    actor: toUserSummaryDto(row.actor),
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    summary: readSummary(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The summary lives inside the JSONB payload, which is typed as unknown JSON. */
function readSummary(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'summary' in payload) {
    const { summary } = payload;
    if (typeof summary === 'string') return summary;
  }

  return '';
}
