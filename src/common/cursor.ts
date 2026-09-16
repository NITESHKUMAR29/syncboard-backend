import { z } from 'zod';

/**
 * Opaque cursors for the append-only feeds (comments, activity).
 *
 * (createdAt, id) is encoded as Base64URL JSON so ordering stays stable when several
 * rows share a timestamp. Clients never parse these (Part B §4).
 */

export interface FeedCursor {
  createdAt: Date;
  id: string;
}

const cursorPayloadSchema = z.object({
  t: z.string(),
  i: z.string().uuid(),
});

export function encodeCursor(cursor: FeedCursor): string {
  const payload = JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/** Returns null for anything that is not a cursor this server produced. */
export function decodeCursor(value: string): FeedCursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = cursorPayloadSchema.safeParse(json);
    if (!parsed.success) return null;

    const createdAt = new Date(parsed.data.t);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt, id: parsed.data.i };
  } catch {
    return null;
  }
}
