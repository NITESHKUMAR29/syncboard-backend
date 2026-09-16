import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env automatically, and the connection URL no longer lives
// in schema.prisma. Both are wired up here. process.loadEnvFile is cross-platform.
try {
  process.loadEnvFile();
} catch {
  // No .env file (CI, Docker, tests) — the environment already carries the variables.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
