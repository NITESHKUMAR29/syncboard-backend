import type { RefreshToken, User } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';

/** The only layer that touches Prisma (NFR-9). */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    now: Date;
  }): Promise<User>;

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  createRefreshToken(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  revokeRefreshToken(id: string, now: Date): Promise<void>;
  revokeAllRefreshTokensForUser(userId: string, now: Date): Promise<void>;
  /** Rotation: revoke the old token and store the new one atomically. */
  rotateRefreshToken(input: {
    oldTokenId: string;
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    findUserByEmail(email) {
      return db.user.findUnique({ where: { email } });
    },

    findUserById(id) {
      return db.user.findUnique({ where: { id } });
    },

    createUser({ id, email, name, passwordHash, now }) {
      return db.user.create({
        data: { id, email, name, passwordHash, createdAt: now, updatedAt: now },
      });
    },

    findRefreshTokenByHash(tokenHash) {
      return db.refreshToken.findUnique({ where: { tokenHash } });
    },

    async createRefreshToken({ id, userId, tokenHash, expiresAt, now }) {
      await db.refreshToken.create({ data: { id, userId, tokenHash, expiresAt, createdAt: now } });
    },

    async revokeRefreshToken(id, now) {
      await db.refreshToken.update({ where: { id }, data: { revokedAt: now } });
    },

    async revokeAllRefreshTokensForUser(userId, now) {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },

    async rotateRefreshToken({ oldTokenId, id, userId, tokenHash, expiresAt, now }) {
      await db.$transaction([
        db.refreshToken.update({ where: { id: oldTokenId }, data: { revokedAt: now } }),
        db.refreshToken.create({ data: { id, userId, tokenHash, expiresAt, createdAt: now } }),
      ]);
    },
  };
}
