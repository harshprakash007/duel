import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import { createRedis } from '../../src/db/redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, '../..');

/** Applies migrations to the test database and flushes test redis once per run. */
export default async function setup(): Promise<void> {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
  const redis = createRedis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
