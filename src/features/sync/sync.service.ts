import type { Clock } from '../../common/clock.js';
import { ValidationError } from '../../common/errors.js';
import { toSyncBoardDto } from '../boards/board.mapper.js';
import { toSyncCommentDto } from '../comments/comment.mapper.js';
import { toSyncTaskDto } from '../tasks/task.mapper.js';
import { toLabelDto, toMemberDto } from '../workspaces/workspace.mapper.js';
import type { AccessGuard } from '../workspaces/access.js';
import type { SyncRepository } from './sync.repository.js';
import type { SyncResponse } from './sync.schemas.js';

/**
 * Delta sync (FR-SYNC-1, FR-SYNC-2).
 *
 * Two rules make this safe for offline clients:
 *
 *   The window overlaps by five seconds. A row committed a moment after the previous
 *   response was serialized would otherwise fall in the gap and never be sent. Clients
 *   upsert by id, so receiving a row twice costs nothing; missing one loses data.
 *
 *   Time comes from the server. Device clocks drift, and a phone running fast would ask
 *   for changes since a future instant and silently skip everything in between.
 */

/** Rows per entity type, per response (FR-SYNC-2). */
export const SYNC_PAGE_LIMIT = 500;

/** How far back the window is widened (FR-SYNC-1). */
export const SYNC_OVERLAP_MS = 5_000;

export interface SyncService {
  changes(workspaceId: string, userId: string, since: string | undefined): Promise<SyncResponse>;
}

export function createSyncService(
  repository: SyncRepository,
  access: AccessGuard,
  clock: Clock,
): SyncService {
  return {
    async changes(workspaceId, userId, since) {
      await access.requireMember(workspaceId, userId);

      const from = parseSince(since);
      const serverTime = clock.now();

      const [boards, tasks, comments, members, labels] = await Promise.all([
        repository.changedBoards(workspaceId, from, SYNC_PAGE_LIMIT + 1),
        repository.changedTasks(workspaceId, from, SYNC_PAGE_LIMIT + 1),
        repository.changedComments(workspaceId, from, SYNC_PAGE_LIMIT + 1),
        repository.currentMembers(workspaceId),
        repository.currentLabels(workspaceId),
      ]);

      // One row past the limit on any entity means another round is needed.
      const hasMore =
        boards.length > SYNC_PAGE_LIMIT ||
        tasks.length > SYNC_PAGE_LIMIT ||
        comments.length > SYNC_PAGE_LIMIT;

      const pagedBoards = boards.slice(0, SYNC_PAGE_LIMIT);
      const pagedTasks = tasks.slice(0, SYNC_PAGE_LIMIT);
      const pagedComments = comments.slice(0, SYNC_PAGE_LIMIT);

      return {
        // When a page was truncated, serverTime is the newest row actually sent, so the
        // next request resumes there instead of skipping what was cut off.
        serverTime: (hasMore
          ? newestUpdatedAt(pagedBoards, pagedTasks, pagedComments, serverTime)
          : serverTime
        ).toISOString(),
        boards: pagedBoards.map((row) => toSyncBoardDto(row.board, row.taskCount)),
        tasks: pagedTasks.map(toSyncTaskDto),
        comments: pagedComments.map(toSyncCommentDto),
        members: members.map(toMemberDto),
        labels: labels.map(toLabelDto),
        hasMore,
      };
    },
  };
}

function parseSince(since: string | undefined): Date | null {
  if (!since) return null;

  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('`since` must be an ISO-8601 timestamp', { since: 'FORMAT_INVALID' });
  }

  return new Date(parsed.getTime() - SYNC_OVERLAP_MS);
}

function newestUpdatedAt(
  boards: { board: { updatedAt: Date } }[],
  tasks: { updatedAt: Date }[],
  comments: { updatedAt: Date }[],
  fallback: Date,
): Date {
  const timestamps = [
    ...boards.map((row) => row.board.updatedAt),
    ...tasks.map((row) => row.updatedAt),
    ...comments.map((row) => row.updatedAt),
  ];

  if (timestamps.length === 0) return fallback;

  return timestamps.reduce((newest, current) => (current > newest ? current : newest));
}
