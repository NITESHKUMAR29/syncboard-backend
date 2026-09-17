import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import { NotFoundError, VersionConflictError } from '../../common/errors.js';
import { appendPosition } from '../../common/positions.js';
import { ActivityAction, EntityType } from '../activity/activity.recorder.js';
import { EventType, type EventBroadcaster } from '../realtime/events.js';
import type { AccessGuard } from '../workspaces/access.js';
import { toBoardDto } from './board.mapper.js';
import type { BoardRepository } from './board.repository.js';
import type { BoardDto, CreateBoardBody, UpdateBoardBody } from './board.schemas.js';

export interface BoardService {
  create(workspaceId: string, userId: string, body: CreateBoardBody): Promise<BoardDto>;
  list(workspaceId: string, userId: string, includeArchived: boolean): Promise<BoardDto[]>;
  get(boardId: string, userId: string): Promise<BoardDto>;
  update(boardId: string, userId: string, body: UpdateBoardBody): Promise<BoardDto>;
  remove(boardId: string, userId: string): Promise<void>;
}

export interface BoardServiceDeps {
  repository: BoardRepository;
  access: AccessGuard;
  clock: Clock;
  events: EventBroadcaster;
  workspaceIdOfBoard: (boardId: string) => Promise<string | null>;
}

export function createBoardService({
  repository,
  access,
  clock,
  events,
  workspaceIdOfBoard,
}: BoardServiceDeps): BoardService {
  /** Resolves a board's workspace and checks the caller's rank in it. */
  async function authorize(boardId: string, userId: string, minimum: 'MEMBER' | 'ADMIN') {
    const workspaceId = await workspaceIdOfBoard(boardId);
    if (!workspaceId) throw new NotFoundError('Board not found');

    if (minimum === 'ADMIN') {
      await access.requireRole(workspaceId, userId, 'ADMIN');
    } else {
      await access.requireMember(workspaceId, userId);
    }

    return workspaceId;
  }

  async function loadDto(boardId: string): Promise<BoardDto> {
    const found = await repository.findWithCount(boardId);
    if (!found || found.board.deletedAt) throw new NotFoundError('Board not found');
    return toBoardDto(found.board, found.taskCount);
  }

  return {
    async create(workspaceId, userId, body) {
      await access.requireRole(workspaceId, userId, 'ADMIN');

      const now = clock.now();
      // FR-BRD-1: appended to the end. The first board lands on 1000.
      const position = appendPosition(await repository.maxPosition(workspaceId));
      const id = randomUUID();

      await repository.create({
        id,
        workspaceId,
        title: body.title,
        position,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.BOARD,
          entityId: id,
          action: ActivityAction.CREATED,
          summary: `created board "${body.title}"`,
        },
      });

      const dto = await loadDto(id);

      events.broadcast({
        type: EventType.BOARD_CREATED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      return dto;
    },

    async list(workspaceId, userId, includeArchived) {
      await access.requireMember(workspaceId, userId);

      const boards = await repository.listByWorkspace(workspaceId, includeArchived);
      return boards.map((row) => toBoardDto(row.board, row.taskCount));
    },

    async get(boardId, userId) {
      await authorize(boardId, userId, 'MEMBER');
      return loadDto(boardId);
    },

    async update(boardId, userId, body) {
      const workspaceId = await authorize(boardId, userId, 'ADMIN');
      const { version, ...changes } = body;
      const now = clock.now();

      const updated = await repository.updateIfVersionMatches({
        id: boardId,
        version,
        data: changes,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.BOARD,
          entityId: boardId,
          action: ActivityAction.UPDATED,
          summary: describeBoardUpdate(changes),
        },
      });

      if (!updated) {
        // Either the row moved on without us, or it is gone. The client needs to tell
        // those apart: one is retryable with the server's copy, the other is not.
        const current = await repository.findWithCount(boardId);
        if (!current || current.board.deletedAt) throw new NotFoundError('Board not found');

        throw new VersionConflictError(
          toBoardDto(current.board, current.taskCount),
          'Board was changed by someone else',
        );
      }

      const dto = await loadDto(boardId);

      events.broadcast({
        type: EventType.BOARD_UPDATED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: dto,
      });

      return dto;
    },

    async remove(boardId, userId) {
      const workspaceId = await authorize(boardId, userId, 'ADMIN');

      const board = await repository.findById(boardId);
      if (!board || board.deletedAt) throw new NotFoundError('Board not found');

      const now = clock.now();

      await repository.softDeleteWithTasks({
        id: boardId,
        now,
        activity: {
          workspaceId,
          actorId: userId,
          entityType: EntityType.BOARD,
          entityId: boardId,
          action: ActivityAction.DELETED,
          summary: `deleted board "${board.title}"`,
        },
      });

      events.broadcast({
        type: EventType.BOARD_DELETED,
        workspaceId,
        actorId: userId,
        occurredAt: now.toISOString(),
        payload: { id: boardId },
      });
    },
  };
}

/** Activity summaries are written now, describing what this edit did. */
function describeBoardUpdate(changes: Omit<UpdateBoardBody, 'version'>): string {
  if (changes.title !== undefined) return `renamed a board to "${changes.title}"`;
  if (changes.archived === true) return 'archived a board';
  if (changes.archived === false) return 'unarchived a board';
  if (changes.position !== undefined) return 'reordered a board';
  return 'updated a board';
}
