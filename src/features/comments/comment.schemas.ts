import { z } from 'zod';
import { cursorPageSchema, cursorPaginationQuerySchema } from '../../common/pagination.js';
import { userSummarySchema } from '../users/user.schemas.js';

/** Comment shapes (Part B §5.3, §5.5). */

export const commentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  author: userSummarySchema,
  body: z.string(),
  /** True once the comment has been edited at least once. */
  edited: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCommentBodySchema = z.object({
  /** Client-generated, so an offline create can be retried without duplicating. */
  id: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(5_000),
});

export const updateCommentBodySchema = z.object({
  version: z.number().int().positive(),
  body: z.string().trim().min(1).max(5_000),
});

export const commentIdParamsSchema = z.object({ id: z.string().uuid() });

export const commentPageSchema = cursorPageSchema(commentSchema);
export const listCommentsQuerySchema = cursorPaginationQuerySchema;

export type CommentDto = z.infer<typeof commentSchema>;
export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;
export type UpdateCommentBody = z.infer<typeof updateCommentBodySchema>;
