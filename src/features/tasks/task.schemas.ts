import { z } from 'zod';
import { offsetPageSchema, offsetPaginationQuerySchema } from '../../common/pagination.js';
import { userSummarySchema } from '../users/user.schemas.js';
import { labelSchema } from '../workspaces/workspace.schemas.js';

/** Task shapes (Part B §5.3, §5.4). */

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** dueDate is a calendar date, not an instant: 2026-09-30. */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date');

export const taskSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assignee: userSummarySchema.nullable(),
  createdBy: userSummarySchema,
  dueDate: z.string().nullable(),
  position: z.number(),
  labels: z.array(labelSchema),
  commentCount: z.number().int(),
  attachmentCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createTaskBodySchema = z.object({
  /** Client-generated, so an offline create can be retried without duplicating. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  status: taskStatusSchema.default('TODO'),
  priority: taskPrioritySchema.default('MEDIUM'),
  assigneeId: z.string().uuid().nullish(),
  dueDate: dateOnlySchema.nullish(),
  labelIds: z.array(z.string().uuid()).default([]),
  /** Absent means append to the end of the board. */
  position: z.number().optional(),
});

/**
 * Partial update (Part A, "PATCH null versus absent"). Fields are `.optional()` so an
 * absent key stays undefined and Prisma leaves the column alone, and `.nullable()` where
 * clearing is meaningful, so an explicit null empties it.
 */
export const updateTaskBodySchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  position: z.number().optional(),
  /** Moving between boards, allowed only within the same workspace. */
  boardId: z.string().uuid().optional(),
});

export const TASK_SORTS = ['position', 'dueDate', '-updatedAt', 'priority'] as const;

export const listTasksQuerySchema = offsetPaginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
  /** `me` resolves to the caller. */
  assigneeId: z.union([z.string().uuid(), z.literal('me')]).optional(),
  priority: taskPrioritySchema.optional(),
  sort: z.enum(TASK_SORTS).default('position'),
});

export const myTasksQuerySchema = offsetPaginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
});

export const taskIdParamsSchema = z.object({ id: z.string().uuid() });

export const taskPageSchema = offsetPageSchema(taskSchema);

export type TaskDto = z.infer<typeof taskSchema>;
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
