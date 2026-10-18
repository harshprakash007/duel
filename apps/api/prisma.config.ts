import { defineConfig } from 'prisma/config';
import { loadDotEnv } from './src/lib/dotenv';

loadDotEnv();

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
