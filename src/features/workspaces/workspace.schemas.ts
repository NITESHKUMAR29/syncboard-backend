import { z } from 'zod';
import { roleSchema } from '../../common/roles.js';
import { offsetPageSchema, offsetPaginationQuerySchema } from '../../common/pagination.js';
import { userSchema } from '../users/user.schemas.js';

/** Workspace, member and label shapes (Part B §5.3, §5.5). */

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ownerId: z.string().uuid(),
  myRole: roleSchema,
  memberCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memberSchema = z.object({
  user: userSchema,
  role: roleSchema,
  joinedAt: z.string(),
});

export const labelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  colorHex: z.string(),
});

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const renameWorkspaceBodySchema = createWorkspaceBodySchema;

export const addMemberBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: roleSchema.default('MEMBER'),
});

export const changeRoleBodySchema = z.object({
  role: roleSchema,
});

export const createLabelBodySchema = z.object({
  name: z.string().trim().min(1).max(30),
  // Exactly six hex digits after a #, per FR-LBL-1.
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a #RRGGBB colour'),
});

export const workspaceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const memberParamsSchema = z.object({
  id: z.string().uuid(),
  // `me` means "leave this workspace" (Part B §5.1).
  userId: z.union([z.string().uuid(), z.literal('me')]),
});

export const labelIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const workspaceListQuerySchema = offsetPaginationQuerySchema;
export const workspacePageSchema = offsetPageSchema(workspaceSchema);

export type WorkspaceDto = z.infer<typeof workspaceSchema>;
export type MemberDto = z.infer<typeof memberSchema>;
export type LabelDto = z.infer<typeof labelSchema>;
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;
export type RenameWorkspaceBody = z.infer<typeof renameWorkspaceBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type ChangeRoleBody = z.infer<typeof changeRoleBodySchema>;
export type CreateLabelBody = z.infer<typeof createLabelBodySchema>;
