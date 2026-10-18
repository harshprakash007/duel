# Decisions log

Choices made where the blueprint was unspecified, plus findings from "verify" probes.
Newest entries go at the bottom of each milestone section.

## M0 — Scaffold

- **Toolchain versions.** Node 24 locally (Docker/CI use Node 22 LTS), pnpm 12. "Current stable" versions were installed,
  with two exceptions:
  - **TypeScript 6.0.x, not 7.0.** `typescript-eslint` (8.71) declares `typescript <6.1`, so TS 7 would break linting.
  - **Prisma 7.10.x, not 8.** npm's `latest` tag for `prisma` is `8.0.0-rc.*` (a release candidate). We use the last
    stable major (the `prev` tag). Prisma 7 requires `prisma.config.ts` and a driver adapter (`@prisma/adapter-pg`).
- **Workspace packages export TypeScript source** (`exports: ./src/index.ts`). Vite and tsx consume them directly; the API
  production build bundles them with tsup (`noExternal: [/^@duel\//]`). This avoids a separate build step per package.
- **Tunable defaults live in `packages/shared/src/constants.ts`**, and the API config module
  (`apps/api/src/config/index.ts`) is the only place that reads env and layers overrides on top. Shared pure functions
  (scoring, Elo, windows) take their params as arguments, so the web app can preview with defaults.
- **`.env` loading** uses Node's built-in `process.loadEnvFile` (no dotenv dependency). Real env vars win.
- **CSRF Origin check:** mutating `/api` requests with an `Origin` header outside `CORS_ORIGIN` are rejected (403).
  Requests without `Origin` are allowed: browsers always send it on cross-site POSTs, and non-browser clients (bots, tests)
  can't ride a victim's cookie.
- **Compose profiles:** `docker compose up` starts only Postgres + Redis (dev infra). `--profile app` adds api, web
  (nginx serving the SPA + reverse proxy with WebSocket upgrade) and a nightly `pg_dump` backup loop.
- **Integration DB:** `duel_test` is created by `deploy/postgres-init.sql`. Tests use Redis DB 15.
- **Full Prisma schema up front.** All §6 models are created in M0 instead of growing per milestone. A `User.deletedAt`
  column was added to support account deletion via anonymization (see M9).
- **Verification problem pool** defaults to `4A, 71A, 231A, 158A, 282A` (configurable via `HANDLE_VERIFY_PROBLEMS`).
- **No-commit-remote:** commits are local only; no remote configured.
- **Host port mappings:** Compose maps Postgres to host 5435 and Redis to host 6385 (`HOST_PGPORT` / `HOST_REDISPORT` configurable) to avoid conflicts with other local services on default ports (5432/6379).
