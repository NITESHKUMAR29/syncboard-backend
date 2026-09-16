import { z } from 'zod';

/** Offset and cursor pagination contracts (Part B §4). */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** page starts at 1, size max 100, default 20. */
export const offsetPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type OffsetPaginationQuery = z.infer<typeof offsetPaginationQuerySchema>;

export const cursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export function offsetPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    size: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  });
}

export function cursorPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function toOffsetPage<T>(
  items: T[],
  totalItems: number,
  { page, size }: OffsetPaginationQuery,
): OffsetPage<T> {
  return {
    items,
    page,
    size,
    totalItems,
    totalPages: size > 0 ? Math.ceil(totalItems / size) : 0,
  };
}

/** Rows to skip for a 1-based page. */
export function toSkip({ page, size }: OffsetPaginationQuery): number {
  return (page - 1) * size;
}
