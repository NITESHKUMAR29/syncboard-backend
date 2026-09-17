import { z } from 'zod';
import { cursorPageSchema, cursorPaginationQuerySchema } from '../../common/pagination.js';
import { userSummarySchema } from '../users/user.schemas.js';

/** Activity feed shapes (Part B §5.3). */

export const activitySchema = z.object({
  id: z.string().uuid(),
  actor: userSummarySchema,
  entityType: z.string(),
  entityId: z.string().uuid(),
  action: z.string(),
  /** Written when the event happened, so later renames do not rewrite history. */
  summary: z.string(),
  createdAt: z.string(),
});

export const activityPageSchema = cursorPageSchema(activitySchema);
export const listActivityQuerySchema = cursorPaginationQuerySchema;

export type ActivityDto = z.infer<typeof activitySchema>;
