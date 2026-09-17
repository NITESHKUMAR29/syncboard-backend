import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/app.js';
import { registerUser } from '../helpers/factories.js';

/** Auth endpoints (FR-AUTH-1…6). */

let testApp: TestApp;

beforeAll(async () => {
  testApp = await buildTestApp();
});

afterAll(async () => {
  await testApp.close();
});

const register = (payload: Record<string, unknown>) =>
  testApp.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });

const login = (payload: Record<string, unknown>) =>
  testApp.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });

const refresh = (refreshToken: string) =>
  testApp.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

describe('POST /auth/register', () => {
  it('creates an account and returns a token pair (FR-AUTH-1)', async () => {
    const response = await register({
      name: 'Ali Khan',
      email: 'ali@example.com',
      password: 'StrongPass123',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      accessToken: expect.stringMatching(/^ey/) as unknown,
      refreshToken: expect.stringMatching(/^rt_/) as unknown,
      user: { name: 'Ali Khan', email: 'ali@example.com', avatarUrl: null },
    });
  });

  it('stores the email lowercase and trimmed', async () => {
    const response = await register({
      name: 'Case Test',
      email: '  MiXeD@Example.COM ',
      password: 'StrongPass123',
    });

    expect(response.json<{ user: { email: string } }>().user.email).toBe('mixed@example.com');
  });

  it('rejects a duplicate email with 409 EMAIL_ALREADY_EXISTS', async () => {
    await register({ name: 'First', email: 'dup@example.com', password: 'StrongPass123' });

    const response = await register({
      name: 'Second',
      email: 'dup@example.com',
      password: 'StrongPass123',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('treats a differently-cased duplicate as the same account', async () => {
    await register({ name: 'First', email: 'casedup@example.com', password: 'StrongPass123' });

    const response = await register({
      name: 'Second',
      email: 'CaseDup@Example.com',
      password: 'StrongPass123',
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects invalid input with 400 and a fields map', async () => {
    const response = await register({ name: '', email: 'not-an-email', password: 'short' });
    const body = response.json<{ error: { code: string; fields: Record<string, string> } }>();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('rejects a password with no digit', async () => {
    const response = await register({
      name: 'No Digits',
      email: 'nodigits@example.com',
      password: 'PasswordOnly',
    });

    expect(response.statusCode).toBe(400);
  });

  it('never returns the password hash', async () => {
    const response = await register({
      name: 'Secret',
      email: 'secret@example.com',
      password: 'StrongPass123',
    });

    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('StrongPass123');
  });
});

describe('POST /auth/login', () => {
  it('returns a token pair for correct credentials (FR-AUTH-2)', async () => {
    await register({ name: 'Login', email: 'login@example.com', password: 'StrongPass123' });

    const response = await login({ email: 'login@example.com', password: 'StrongPass123' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ accessToken: string }>().accessToken).toMatch(/^ey/);
  });

  it('is case-insensitive on the email (A9)', async () => {
    await register({ name: 'Case', email: 'caselogin@example.com', password: 'StrongPass123' });

    const response = await login({ email: 'CaseLogin@Example.COM', password: 'StrongPass123' });

    expect(response.statusCode).toBe(200);
  });

  it('returns an identical 401 for a wrong password and an unknown email', async () => {
    await register({ name: 'Real', email: 'real@example.com', password: 'StrongPass123' });

    const wrongPassword = await login({ email: 'real@example.com', password: 'WrongPass123' });
    const unknownEmail = await login({ email: 'ghost@example.com', password: 'StrongPass123' });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);

    // Identical down to the code and message: nothing reveals which half was wrong.
    const strip = (body: string) => body.replace(/"requestId":"[^"]*"/, '');
    expect(strip(wrongPassword.body)).toBe(strip(unknownEmail.body));
    expect(wrongPassword.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_CREDENTIALS',
    );
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the token pair (FR-AUTH-4)', async () => {
    const user = await registerUser(testApp.app);

    const response = await refresh(user.refreshToken);
    const body = response.json<{ accessToken: string; refreshToken: string }>();

    expect(response.statusCode).toBe(200);
    expect(body.refreshToken).not.toBe(user.refreshToken);
    expect(body.refreshToken).toMatch(/^rt_/);
  });

  it('revokes the old refresh token', async () => {
    const user = await registerUser(testApp.app);
    await refresh(user.refreshToken);

    const reused = await refresh(user.refreshToken);

    expect(reused.statusCode).toBe(401);
    expect(reused.json<{ error: { code: string } }>().error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('revokes every session when a revoked token is replayed (theft detection)', async () => {
    const user = await registerUser(testApp.app);

    // Legitimate rotation, then an attacker replays the token they captured.
    const rotated = await refresh(user.refreshToken);
    const newToken = rotated.json<{ refreshToken: string }>().refreshToken;

    await refresh(user.refreshToken);

    // The token the real user now holds must be dead too.
    const afterTheft = await refresh(newToken);
    expect(afterTheft.statusCode).toBe(401);
  });

  it('rejects a token that was never issued', async () => {
    const response = await refresh('rt_not-a-real-token');

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  const logout = (refreshToken: string) =>
    testApp.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken } });

  it('revokes the token and returns 204 (FR-AUTH-5)', async () => {
    const user = await registerUser(testApp.app);

    const response = await logout(user.refreshToken);

    expect(response.statusCode).toBe(204);
    expect((await refresh(user.refreshToken)).statusCode).toBe(401);
  });

  it('returns 204 when the token is already revoked', async () => {
    const user = await registerUser(testApp.app);
    await logout(user.refreshToken);

    expect((await logout(user.refreshToken)).statusCode).toBe(204);
  });

  it('returns 204 for a token that never existed', async () => {
    expect((await logout('rt_never-existed')).statusCode).toBe(204);
  });
});

describe('access token authentication (FR-AUTH-3)', () => {
  const getMe = (headers: Record<string, string>) =>
    testApp.app.inject({ method: 'GET', url: '/api/v1/users/me', headers });

  it('accepts a valid token', async () => {
    const user = await registerUser(testApp.app);

    const response = await getMe(user.auth);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(user.email);
  });

  it('rejects a missing token with TOKEN_INVALID', async () => {
    const response = await getMe({});

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a malformed token with TOKEN_INVALID', async () => {
    const response = await getMe({ authorization: 'Bearer not.a.jwt' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciJ9.wrong-signature';

    const response = await getMe({ authorization: `Bearer ${forged}` });

    expect(response.statusCode).toBe(401);
  });
});
