import { describe, expect, it } from 'vitest';
import { offsetPaginationQuerySchema, toOffsetPage, toSkip } from '../../src/common/pagination.js';

describe('offset pagination query', () => {
  it('defaults to page 1, size 20', () => {
    expect(offsetPaginationQuerySchema.parse({})).toEqual({ page: 1, size: 20 });
  });

  it('coerces the query string values', () => {
    expect(offsetPaginationQuerySchema.parse({ page: '3', size: '50' })).toEqual({
      page: 3,
      size: 50,
    });
  });

  it('caps size at 100 and rejects page 0', () => {
    expect(offsetPaginationQuerySchema.safeParse({ size: '101' }).success).toBe(false);
    expect(offsetPaginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('toOffsetPage', () => {
  it('matches the documented envelope', () => {
    const page = toOffsetPage(['a', 'b'], 57, { page: 1, size: 20 });

    expect(page).toEqual({ items: ['a', 'b'], page: 1, size: 20, totalItems: 57, totalPages: 3 });
  });

  it('reports zero pages for an empty collection', () => {
    expect(toOffsetPage([], 0, { page: 1, size: 20 }).totalPages).toBe(0);
  });
});

describe('toSkip', () => {
  it('is 0 on the first page', () => {
    expect(toSkip({ page: 1, size: 20 })).toBe(0);
  });

  it('skips whole pages thereafter', () => {
    expect(toSkip({ page: 3, size: 20 })).toBe(40);
  });
});
