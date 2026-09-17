import { z } from 'zod';

/** Shared user shapes (Part B §5.3). */

/** The compact form embedded in tasks, comments and activity. */
export const userSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export type UserSummaryDto = z.infer<typeof userSummarySchema>;

/** The caller's own profile, which also carries the email. */
export const userSchema = userSummarySchema.extend({
  email: z.string(),
});

export type UserDto = z.infer<typeof userSchema>;

export const updateMeBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;
