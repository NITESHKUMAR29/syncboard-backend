import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Starting a container and applying migrations is slow on a cold Docker daemon.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.service.ts', 'src/common/**/*.ts', 'src/config/**/*.ts'],
      exclude: ['src/generated/**'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
