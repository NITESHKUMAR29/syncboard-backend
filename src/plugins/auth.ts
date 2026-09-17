import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TokenExpiredError, TokenInvalidError } from '../common/errors.js';
import type { Env } from '../config/env.js';
import type { AccessTokenIssuer } from '../features/auth/auth.service.js';

/**
 * Access tokens (Part B §6).
 *
 * JWT signed with HS256, claims sub/iat/exp/iss/aud, 15 minutes, never stored server
 * side. The token carries no roles: they are read from workspace_members on every
 * request, so a role change or a removal takes effect immediately.
 */

export async function registerAuth(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      algorithm: 'HS256',
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
  });

  /**
   * Route guard. Distinguishes an expired token from an invalid one using the library's
   * error code, because the Android client refreshes on TOKEN_EXPIRED and logs out on
   * TOKEN_INVALID (FR-AUTH-3).
   */
  app.decorate(
    'requireAuth',
    async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
      try {
        const payload = await request.jwtVerify<{ sub?: string }>();

        if (!payload.sub) {
          throw new TokenInvalidError();
        }

        request.authUser = { userId: payload.sub };

        // NFR-8: every log line for this request carries the user id.
        request.log = request.log.child({ userId: payload.sub });
      } catch (error) {
        if (error instanceof TokenInvalidError) throw error;

        const code = (error as { code?: string }).code;
        if (code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
          throw new TokenExpiredError();
        }

        throw new TokenInvalidError();
      }
    },
  );
}

/** Signs access tokens for the auth service, which must not import Fastify. */
export function createAccessTokenIssuer(app: FastifyInstance, env: Env): AccessTokenIssuer {
  return {
    sign(userId: string) {
      const token = app.jwt.sign({ sub: userId });
      const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000);
      return { token, expiresAt };
    },
  };
}

/** The caller's id on a route behind requireAuth. */
export function requireUserId(request: FastifyRequest): string {
  if (!request.authUser) {
    // Only reachable if a route forgets its guard.
    throw new TokenInvalidError();
  }
  return request.authUser.userId;
}
