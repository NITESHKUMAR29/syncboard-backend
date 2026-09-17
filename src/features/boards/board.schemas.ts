import { z } from 'zod';

/** Board shapes (Part B §5.3, §5.5). */

export const boardSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  position: z.number(),
  archived: z.boolean(),
  taskCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createBoardBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
});

/**
 * PATCH sends only what changed plus the version it was based on. An absent key means
 * unchanged; Prisma ignores `undefined` in `data`, so absent fields never reach the row.
 */
export const updateBoardBodySchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(100).optional(),
  position: z.number().optional(),
  archived: z.boolean().optional(),
});

export const boardIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listBoardsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type BoardDto = z.infer<typeof boardSchema>;
export type CreateBoardBody = z.infer<typeof createBoardBodySchema>;
export type UpdateBoardBody = z.infer<typeof updateBoardBodySchema>;
