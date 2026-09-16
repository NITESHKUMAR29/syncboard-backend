/**
 * Injectable clock (NFR-10). Services take a Clock instead of calling `new Date()`
 * so tests can freeze or advance time.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test double: returns a fixed instant until `set` or `advance` moves it. */
export function fixedClock(start: Date = new Date('2026-09-17T10:00:00.000Z')): Clock & {
  set(date: Date): void;
  advance(milliseconds: number): void;
} {
  let current = new Date(start.getTime());

  return {
    now: () => new Date(current.getTime()),
    set: (date: Date) => {
      current = new Date(date.getTime());
    },
    advance: (milliseconds: number) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}
