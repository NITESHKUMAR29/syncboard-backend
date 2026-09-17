import type { FastifyInstance } from 'fastify';

/** Builders that drive the API the way the Android app does, rather than seeding rows. */

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Ready-made Authorization header. */
  auth: { authorization: string };
}

interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
}

let counter = 0;

export async function registerUser(
  app: FastifyInstance,
  overrides: { name?: string; email?: string; password?: string } = {},
): Promise<RegisteredUser> {
  counter += 1;

  const payload = {
    name: overrides.name ?? `Test User ${String(counter)}`,
    email: overrides.email ?? `user${String(counter)}@example.com`,
    password: overrides.password ?? 'StrongPass123',
  };

  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });

  if (response.statusCode !== 201) {
    throw new Error(`registerUser failed: ${String(response.statusCode)} ${response.body}`);
  }

  const body = response.json<TokenPairResponse>();

  return {
    id: body.user.id,
    name: body.user.name,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    auth: { authorization: `Bearer ${body.accessToken}` },
  };
}
