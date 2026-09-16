import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/common/cursor.js';

describe('cursors', () => {
  it('round-trips (createdAt, id)', () => {
    const cursor = { createdAt: new Date('2026-09-16T10:15:00Z'), id: randomUUID() };

    const decoded = decodeCursor(encodeCursor(cursor));

    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
  });

  it('is URL-safe so it survives a query string unescaped', () => {
    const encoded = encodeCursor({ createdAt: new Date(), id: randomUUID() });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for a cursor this server did not produce', () => {
    expect(decodeCursor('not-base64!')).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":"x"}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('plain text').toString('base64url'))).toBeNull();
  });

  it('rejects a cursor whose id is not a UUID', () => {
    const forged = Buffer.from(JSON.stringify({ t: new Date().toISOString(), i: '1' })).toString(
      'base64url',
    );

    expect(decodeCursor(forged)).toBeNull();
  });
});
