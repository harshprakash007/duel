import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/int/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres + Redis; run files serially.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: ['test/int/global-setup.ts'],
  },
});
