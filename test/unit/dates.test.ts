import { describe, expect, it } from 'vitest';
import { fromDateOnly, toDateOnly, toDateOnlyOrNull, toIsoString } from '../../src/common/dates.js';

describe('toDateOnly', () => {
  it('formats from UTC parts', () => {
    expect(toDateOnly(new Date('2026-09-30T10:00:00Z'))).toBe('2026-09-30');
  });

  it('does not shift the day for instants near midnight UTC', () => {
    // The trap: in any timezone west of UTC, local formatting would say 2026-09-29.
    expect(toDateOnly(new Date('2026-09-30T00:00:00Z'))).toBe('2026-09-30');
    expect(toDateOnly(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-30');
  });

  it('passes null through', () => {
    expect(toDateOnlyOrNull(null)).toBeNull();
  });
});

describe('fromDateOnly', () => {
  it('round-trips with toDateOnly', () => {
    expect(toDateOnly(fromDateOnly('2026-02-28'))).toBe('2026-02-28');
  });

  it('parses to midnight UTC', () => {
    expect(fromDateOnly('2026-09-30').toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('rejects a malformed date', () => {
    expect(() => fromDateOnly('30-09-2026')).toThrow(RangeError);
  });

  it('rejects a date that does not exist', () => {
    expect(() => fromDateOnly('2026-02-30')).toThrow(RangeError);
  });
});

describe('toIsoString', () => {
  it('serializes with a trailing Z', () => {
    expect(toIsoString(new Date('2026-09-16T10:30:00Z'))).toBe('2026-09-16T10:30:00.000Z');
  });
});
