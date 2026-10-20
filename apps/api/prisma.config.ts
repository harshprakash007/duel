import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (typeof process.loadEnvFile === 'function') {
  for (const f of ['.env', '../../.env', '../.env']) {
    if (existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch {
        /* ignore invalid env file */
      }
    }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` doesn't need a live DB, so tolerate a missing URL there.
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@localhost:5432/invalid',
  },
});
