import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env` files without overriding real env vars: first `apps/api/.env`, then the repo root `.env`.
 * Production deployments pass env directly and have no `.env` files.
 */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(here, '../../.env'),
    resolve(here, '../../../../.env'),
  ];
  const seen = new Set<string>();
  for (const file of candidates) {
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    process.loadEnvFile(file);
  }
}
