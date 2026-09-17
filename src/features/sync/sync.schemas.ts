import { z } from 'zod';
import { boardSchema } from '../boards/board.schemas.js';
import { commentSchema } from '../comments/comment.schemas.js';
import { taskSchema } from '../tasks/task.schemas.js';
import { labelSchema, memberSchema } from '../workspaces/workspace.schemas.js';

/** Delta sync (Part B §7.1). */

/** Syncable rows carry deletedAt: a non-null value tells the client to drop it locally. */
const deletable = { deletedAt: z.string().nullable() };

export const syncBoardSchema = boardSchema.extend(deletable);
export const syncTaskSchema = taskSchema.extend(deletable);
export const syncCommentSchema = commentSchema.extend(deletable);

export const syncQuerySchema = z.object({
  /** Omitted for a full first sync. */
  since: z.string().datetime({ offset: true }).optional(),
});

export const syncResponseSchema = z.object({
  /** From the server clock. The client stores it and sends it as the next `since`. */
  serverTime: z.string(),
  boards: z.array(syncBoardSchema),
  tasks: z.array(syncTaskSchema),
  comments: z.array(syncCommentSchema),
  /** The full current list, not a delta: membership is small and cheap to replace. */
  members: z.array(memberSchema),
  labels: z.array(labelSchema),
  hasMore: z.boolean(),
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;
