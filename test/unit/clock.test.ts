import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from '../../src/common/clock.js';

describe('fixedClock', () => {
  it('does not move on its own', () => {
    const clock = fixedClock(new Date('2026-09-17T10:00:00Z'));

    expect(clock.now().toISOString()).toBe('2026-09-17T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-17T10:00:00.000Z');
  });

  it('advances only when told to', () => {
    const clock = fixedClock(new Date('2026-09-17T10:00:00Z'));

    clock.advance(60_000);

    expect(clock.now().toISOString()).toBe('2026-09-17T10:01:00.000Z');
  });

  it('hands out copies so a caller cannot mutate the clock', () => {
    const clock = fixedClock(new Date('2026-09-17T10:00:00Z'));

    clock.now().setUTCFullYear(2000);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('systemClock', () => {
  it('tracks real time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
