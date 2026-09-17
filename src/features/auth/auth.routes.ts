import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AUTH_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from '../../plugins/security.js';
import { createAuthRepository } from './auth.repository.js';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
  tokenPairSchema,
} from './auth.schemas.js';
import { createAuthService, type AccessTokenIssuer } from './auth.service.js';

export interface AuthRoutesOptions {
  accessTokens: AccessTokenIssuer;
}

/**
 * Auth endpoints (Part B §5.2). All are public, and all are rate limited to 10 requests
 * per minute per IP rather than the API-wide 120 (Part B §4), because they are the ones
 * worth brute-forcing.
 */
export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const service = createAuthService({
    repository: createAuthRepository(app.prisma),
    clock: app.clock,
    accessTokens: options.accessTokens,
    refreshTokenTtlDays: app.env.REFRESH_TOKEN_TTL_DAYS,
  });

  const authRateLimit = {
    rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW },
  };

  app.post(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        description:
          'Creates a user and returns a token pair. Emails are stored lowercase and must be unique.',
        body: registerBodySchema,
        response: { 201: tokenPairSchema },
      },
    },
    async (request, reply) => {
      const tokens = await service.register(request.body);
      return reply.status(201).send(tokens);
    },
  );

  app.post(
    '/auth/login',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Log in',
        description:
          'A wrong email and a wrong password return the same 401 INVALID_CREDENTIALS, in the same time.',
        body: loginBodySchema,
        response: { 200: tokenPairSchema },
      },
    },
    async (request) => service.login(request.body),
  );

  app.post(
    '/auth/refresh',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Rotate the refresh token',
        description:
          'Revokes the presented token and issues a new pair. Presenting an already revoked token revokes every session for that user.',
        body: refreshBodySchema,
        response: { 200: tokenPairSchema },
      },
    },
    async (request) => service.refresh(request.body.refreshToken),
  );

  app.post(
    '/auth/logout',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token',
        description: 'Returns 204 even when the token is unknown or already revoked.',
        body: logoutBodySchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.logout(request.body.refreshToken);
      return reply.status(204).send();
    },
  );
};
