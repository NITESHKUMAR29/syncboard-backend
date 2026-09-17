import { z } from 'zod';

/**
 * Environment configuration (Part B §8).
 *
 * The app refuses to start if a required variable is missing or invalid and prints
 * exactly which one. Nothing else in the codebase reads process.env directly.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // NFR-3: the JWT secret must be at least 32 bytes.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).default('taskflow'),
  JWT_AUDIENCE: z.string().min(1).default('taskflow-android'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // FR-AUTH-6 mandates cost 12. Only the test suite lowers it, where hashing hundreds of
  // throwaway passwords at cost 12 would dominate the run time.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  // File storage: empty STORAGE_BUCKET means local disk (A9).
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),

  // Push: empty means log-only sender (A9).
  FIREBASE_CREDENTIALS_JSON: z.string().optional(),

  CORS_ALLOWED_ORIGINS: z.string().default(''),
  ENABLE_SWAGGER_UI: booleanish.default(true),
  // Off in the test suite, which would otherwise throttle itself: every request comes
  // from the same address. The rate limiter's own tests turn it back on.
  RATE_LIMIT_ENABLED: booleanish.default(true),
});

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment, throwing a readable error listing every problem. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}

/** Comma-separated CORS origins; an empty value disables cross-origin requests. */
export function corsOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
