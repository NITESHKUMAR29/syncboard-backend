import type { Board } from '../../generated/prisma/client.js';
import type { BoardDto } from './board.schemas.js';

export function toBoardDto(board: Board, taskCount: number): BoardDto {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    title: board.title,
    position: board.position,
    archived: board.archived,
    taskCount,
    version: board.version,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}

/** The sync feed adds deletedAt to the standard DTO (Part B §7.1). */
export function toSyncBoardDto(board: Board, taskCount: number) {
  return {
    ...toBoardDto(board, taskCount),
    deletedAt: board.deletedAt ? board.deletedAt.toISOString() : null,
  };
}
