import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Clock } from '../../common/clock.js';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  RefreshTokenInvalidError,
} from '../../common/errors.js';
import { toUserDto } from '../users/user.mapper.js';
import type { AuthRepository } from './auth.repository.js';
import type { LoginBody, RegisterBody, TokenPairDto } from './auth.schemas.js';
import { generateRefreshToken, hashRefreshToken } from './auth.tokens.js';
import type { User } from '../../generated/prisma/client.js';

/**
 * A hash of a value nobody can log in with. When the email is unknown we still run a
 * bcrypt comparison against this, so a wrong email and a wrong password take the same
 * time and an attacker cannot enumerate accounts by timing (FR-AUTH-2). It is computed
 * at the configured cost so the timing actually matches.
 */
function dummyHashFor(cost: number): string {
  return bcrypt.hashSync('taskflow-timing-equalizer', cost);
}

export interface AccessTokenIssuer {
  /** Signs the access token and reports when it expires. */
  sign(userId: string): { token: string; expiresAt: Date };
}

export interface AuthService {
  register(body: RegisterBody): Promise<TokenPairDto>;
  login(body: LoginBody): Promise<TokenPairDto>;
  refresh(refreshToken: string): Promise<TokenPairDto>;
  logout(refreshToken: string): Promise<void>;
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  clock: Clock;
  accessTokens: AccessTokenIssuer;
  refreshTokenTtlDays: number;
  /** FR-AUTH-6: 12 in production. */
  bcryptCost: number;
}

export function createAuthService({
  repository,
  clock,
  accessTokens,
  refreshTokenTtlDays,
  bcryptCost,
}: AuthServiceDeps): AuthService {
  const dummyHash = dummyHashFor(bcryptCost);

  /** Issues a fresh access token plus a brand new refresh token. */
  async function issueTokenPair(user: User): Promise<TokenPairDto> {
    const now = clock.now();
    const access = accessTokens.sign(user.id);
    const refresh = generateRefreshToken();
    const refreshExpiresAt = addDays(now, refreshTokenTtlDays);

    await repository.createRefreshToken({
      id: refresh.id,
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refreshExpiresAt,
      now,
    });

    return buildTokenPair(user, access, refresh.token, refreshExpiresAt);
  }

  return {
    async register(body) {
      const existing = await repository.findUserByEmail(body.email);
      if (existing) {
        throw new EmailAlreadyExistsError();
      }

      const now = clock.now();
      const passwordHash = await bcrypt.hash(body.password, bcryptCost);

      const user = await repository.createUser({
        id: randomUUID(),
        email: body.email,
        name: body.name,
        passwordHash,
        now,
      });

      return issueTokenPair(user);
    },

    async login(body) {
      const user = await repository.findUserByEmail(body.email);

      // Always compare, even with no user, to keep the timing identical.
      const matches = await bcrypt.compare(body.password, user?.passwordHash ?? dummyHash);

      if (!user || !matches) {
        // The same error either way: never reveal which half was wrong.
        throw new InvalidCredentialsError();
      }

      return issueTokenPair(user);
    },

    async refresh(refreshToken) {
      const stored = await repository.findRefreshTokenByHash(hashRefreshToken(refreshToken));
      const now = clock.now();

      if (!stored) {
        throw new RefreshTokenInvalidError();
      }

      // A revoked token being presented again means it was captured after a legitimate
      // rotation. The holder is not trustworthy, so every session for this user ends
      // (FR-AUTH-4, theft detection).
      if (stored.revokedAt) {
        await repository.revokeAllRefreshTokensForUser(stored.userId, now);
        throw new RefreshTokenInvalidError();
      }

      if (stored.expiresAt.getTime() <= now.getTime()) {
        throw new RefreshTokenInvalidError();
      }

      const user = await repository.findUserById(stored.userId);
      if (!user) {
        throw new RefreshTokenInvalidError();
      }

      const access = accessTokens.sign(user.id);
      const next = generateRefreshToken();
      const refreshExpiresAt = addDays(now, refreshTokenTtlDays);

      // Revoking the old token and storing the new one must not half-happen.
      await repository.rotateRefreshToken({
        oldTokenId: stored.id,
        id: next.id,
        userId: user.id,
        tokenHash: next.tokenHash,
        expiresAt: refreshExpiresAt,
        now,
      });

      return buildTokenPair(user, access, next.token, refreshExpiresAt);
    },

    async logout(refreshToken) {
      const stored = await repository.findRefreshTokenByHash(hashRefreshToken(refreshToken));

      // FR-AUTH-5: 204 even when the token is unknown or already revoked. Logging out
      // twice, or with a stale token, is not an error the client can act on.
      if (stored && !stored.revokedAt) {
        await repository.revokeRefreshToken(stored.id, clock.now());
      }
    },
  };
}

function buildTokenPair(
  user: User,
  access: { token: string; expiresAt: Date },
  refreshToken: string,
  refreshTokenExpiresAt: Date,
): TokenPairDto {
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    user: toUserDto(user),
  };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
