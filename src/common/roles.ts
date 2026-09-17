import { z } from 'zod';

/** Workspace roles (Part B §6). */

export const ROLES = ['MEMBER', 'ADMIN', 'OWNER'] as const;

export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES);

/** Higher rank means more permission. Comparing ranks is how requireRole decides. */
const RANK: Record<Role, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function rankOf(role: Role): number {
  return RANK[role];
}

export function isAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export function isRole(value: string): value is Role {
  return value in RANK;
}
