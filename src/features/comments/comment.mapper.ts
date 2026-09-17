import type { Comment, User } from '../../generated/prisma/client.js';
import { toUserSummaryDto } from '../users/user.mapper.js';
import type { CommentDto } from './comment.schemas.js';

export type CommentWithAuthor = Comment & { author: User };

export function toCommentDto(comment: CommentWithAuthor): CommentDto {
  return {
    id: comment.id,
    taskId: comment.taskId,
    author: toUserSummaryDto(comment.author),
    body: comment.body,
    // FR-CMT-3: version 1 is the original; anything higher has been edited.
    edited: comment.version > 1,
    version: comment.version,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

/** The sync feed adds deletedAt to the standard DTO (Part B §7.1). */
export function toSyncCommentDto(comment: CommentWithAuthor) {
  return {
    ...toCommentDto(comment),
    deletedAt: comment.deletedAt ? comment.deletedAt.toISOString() : null,
  };
}
