import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each file builds its own in-memory database, so nothing is shared and files can
    // run in parallel. Starting PostgreSQL-in-WASM costs a second or two per file.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.service.ts', 'src/common/**/*.ts', 'src/config/**/*.ts'],
      exclude: ['src/generated/**'],
      thresholds: { lines: 80 },
    },
  },
});
