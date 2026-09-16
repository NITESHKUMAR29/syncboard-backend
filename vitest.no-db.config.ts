import { defineConfig } from 'vitest/config';

/**
 * The subset of the suite that runs without Docker: pure units and app-level tests that
 * use a stub database. `npm test` (vitest.config.ts) is the real gate and covers these
 * too, plus everything that needs PostgreSQL.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/app.test.ts'],
    testTimeout: 15_000,
  },
});
