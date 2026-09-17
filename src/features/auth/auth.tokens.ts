import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Refresh tokens (Part B §6).
 *
 * A random 256-bit value, Base64URL, prefixed `rt_`. Only its SHA-256 hash is stored, so
 * a database leak cannot be replayed against the API. Raw tokens are never logged.
 */

const REFRESH_TOKEN_PREFIX = 'rt_';
const REFRESH_TOKEN_BYTES = 32;

export interface GeneratedRefreshToken {
  /** Returned to the client once and never again. */
  token: string;
  /** What goes in the database. */
  tokenHash: string;
  id: string;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const token = REFRESH_TOKEN_PREFIX + randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

  return { token, tokenHash: hashRefreshToken(token), id: randomUUID() };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
