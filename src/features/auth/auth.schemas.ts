import { z } from 'zod';
import { userSchema } from '../users/user.schemas.js';

/** Auth request and response bodies (Part B §5.2). */

/** 8–72 characters with at least one letter and one digit. 72 is bcrypt's input limit. */
const passwordSchema = z
  .string()
  .min(8, 'Password must be between 8 and 72 characters')
  .max(72, 'Password must be between 8 and 72 characters')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Password must contain at least one letter and one digit',
  });

/** Emails are trimmed and stored lowercase; login is case-insensitive (A9). */
const emailSchema = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);

export const registerBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: emailSchema,
  // Not the full password policy: an old password that no longer meets it must still work.
  password: z.string().min(1).max(72),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutBodySchema = refreshBodySchema;

/** register, login and refresh all return this. */
export const tokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string(),
  user: userSchema,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type LogoutBody = z.infer<typeof logoutBodySchema>;
export type TokenPairDto = z.infer<typeof tokenPairSchema>;
