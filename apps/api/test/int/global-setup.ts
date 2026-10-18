import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './env';

/** Applies migrations to the test database once per run. */
export default function setup(): void {
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
