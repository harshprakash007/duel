/** Connection settings for integration tests (real Postgres + Redis, e.g. from docker compose). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://duel:duel@localhost:5435/duel_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6385/15';

export const testEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  JWT_SECRET: 'test-secret-test-secret-test-secret!!',
  CORS_ORIGIN: 'http://localhost:5173',
  JOBS_ENABLED: 'false',
  PORT: '0',
  ...extra,
});
