/**
 * Serialization helpers (Part A, "Serialization pitfalls").
 *
 * Timestamps are ISO-8601 UTC with a trailing Z. `dueDate` is a DATE column and must be
 * formatted from UTC parts, never from local time, or a task due 2026-09-30 can render
 * as 2026-09-29 west of Greenwich.
 */

/** ISO-8601 in UTC, e.g. 2026-09-16T10:30:00.000Z */
export function toIsoString(date: Date): string {
  return date.toISOString();
}

export function toIsoStringOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** YYYY-MM-DD from the date's UTC parts. */
export function toDateOnly(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toDateOnlyOrNull(date: Date | null | undefined): string | null {
  return date ? toDateOnly(date) : null;
}

/** Parses YYYY-MM-DD into midnight UTC, the form a Postgres DATE column round-trips. */
export function fromDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}"`);
  }

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (toDateOnly(date) !== value) {
    throw new RangeError(`"${value}" is not a real calendar date`);
  }

  return date;
}
