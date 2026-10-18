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

## M1 — Codeforces Client

- **Real Codeforces Probe Results (`pnpm cf:probe`):**
  - Host tested: local machine (Linux, Node v24.4.1).
  - All 4 endpoints succeeded without authentication:
    - `problemset.problems`: 11,467 problems and statistics validated (1570ms).
    - `problemset.recentStatus(10)`: validated 10 submissions with BigInt IDs (402ms, max ID: 395081078).
    - `user.info(['tourist'])`: successfully returned handle 'tourist', rating 3380, rank 'legendary grandmaster' (675ms).
    - `user.status('tourist', 1, 5)`: returned 5 historical submissions (392ms).
  - Verdict: Codeforces API is completely accessible and responsive with the specified User-Agent and schema.
- **Limiter design:**
  - Token bucket with 3 priority lanes (`high`, `normal`, `low`) and strict priority draining.
  - An aging guard (default 5,000ms) prevents starvation of low-priority sync jobs during bursts of player-triggered activity.
  - Active scheduled refill timers maintain Node event loop activity so processes do not exit prematurely while requests are enqueued.
- **Circuit breaker & error differentiation:**
  - Circuit breaker trips to `DEGRADED` after `degradedAfterFailures` (default 4) consecutive retryable failures (5xx, timeouts, 429 / "limit" comments).
  - User not found (e.g., non-existent handle) is normalized as `CfUserNotFoundError` (non-retryable, does not increment circuit breaker failures).
  - First successful request automatically clears `DEGRADED` back to `OK` and emits `stateChange` and `recovered` events.
- **Fake Codeforces Server:**
  - Embedded Express in-memory server with seedable problems, statistics, users, controllable submissions (TESTING -> final transitions), outage simulation, failure injectors (`500`, `rate-limit`, `timeout`, `network`), and `recentStatus` window truncation.

## M2 — Auth and Handle Linking

- **Password hashing:** Argon2id with 19 MiB memory cost, 2 iterations, 1 parallelism via `argon2`.
- **Session token & transport:**
  - Signed HS256 JWT in an `httpOnly`, `SameSite=Lax` cookie (`duel_session`), valid for 7 days.
  - In production (`NODE_ENV === 'production'`), `Secure` flag is enforced.
  - Fallback to `Authorization: Bearer <token>` supported for API testing and non-browser clients.
- **CSRF Defense:** SameSite=Lax cookies combined with Origin header verification on all mutating requests.
- **Handle verification flow:**
  - `POST /api/handles/link/start`: validates Codeforces existence via high-priority `user.info`. Ensures handle is not already bound to another account. Supercedes prior pending attempts.
  - Assigned problem chosen at random from configured pool (`HANDLE_VERIFY_PROBLEMS`).
  - `POST /api/handles/link/verify`: queries `user.status` for `COMPILATION_ERROR` within verification window (with 5s slack). Clamps initial rating into `[RATING_INIT_MIN, RATING_INIT_MAX]` (800–2400) based on `cfRating ?? 1000`.
  - Atomically creates `CfHandle` and `PlayerRating` inside a database transaction.
- **Rate limiting:**
  - Express rate limiter backed by Redis store (`rate-limit-redis`) with per-user (or per-IP fallback) tracking.
  - Dedicated stricter limits for auth (20 req / 15 min) and handle verification (10 req / hour).
- **Web UI:**
  - Login, registration, and responsive interactive handle linking wizard with live 5-minute countdown and verification polling.

## M3 — Problem Catalog, Sheets, Solved-Set & Picker

- **Problem Catalog Sync:**
  - Queries `problemset.problems` on the low-priority lane.
  - Skips non-programming questions (`type !== 'PROGRAMMING'`), unrated problems, and problems matching configured exclude tags (`*special`, `interactive`).
  - Maps problem statistics (`solvedCount`) and upserts in chunks of 500 records inside Prisma transactions.
  - Deactivates missing problems (`isActive = false`) based on sync timestamp threshold.
  - Prevents concurrent executions with `AppError('CONFLICT', 'Catalog sync already in progress')`.
  - BullMQ repeatable scheduler (`0 3 * * *`) plus admin manual trigger (`POST /api/admin/problems/sync`).
- **Level Sheets (L1–L6):**
  - Seed definitions: L1 Warm-up (800–1000), L2 Rookie (1000–1200), L3 Challenger (1200–1400), L4 Contender (1400–1700), L5 Expert (1700–2000), L6 Master (2000–2400).
  - Seed script `prisma/seed.ts` seeds default sheets and admin account (`admin@duel.local`).
  - Public endpoints: `GET /api/sheets` (computes live active problem count) and `GET /api/sheets/:slug`.
  - Admin endpoints: `GET /api/admin/sheets`, `POST /api/admin/sheets` (`CreateSheetInputSchema`), and `PATCH /api/admin/sheets/:id` (`UpdateSheetInputSchema`).
- **Incremental Solved-Set Crawler (`SolvedSetService`):**
  - Walks `user.status` starting at `from: 1` in batches of 100 until reaching `solvedSyncedUpToId` or exhausting history.
  - Extracts all `OK` verdicts with valid contest IDs and bulk inserts them into `UserSolved` (`skipDuplicates: true`).
  - Updates `cfHandle.solvedSyncedUpToId` (never downgraded) and `solvedSyncedAt`.
  - Automatically triggered in the background upon successful handle verification and match queue join.
- **Problem Picker (`PickerService` & `selectProblems`):**
  - Pure function `selectProblems`: computes linearly spaced rating targets across $[minRating, maxRating]$, rounded to nearest `PICKER_SNAP` (100). Matches candidates within progressive window $[target - window, target + window]$ (widening by `windowStep` if empty, falling back to remaining pool). Uniform random sampling without replacement preserves target rating slot order.
  - `PickerService`: filters candidate problems by sheet rating band, solved count, and tag inclusions/exclusions (or curated problems in `LevelSheetProblem`), excluding problems in `UserSolved` for either player and problems from either player's recent 50 matches (`MatchQuestion`).
  - Throws `ABORT_NO_PROBLEMS` if eligible problems $< N$.

## M4 — Submission Poller & Risk Gate

- **Redis Leader Lock (`LeaderLock`):**
  - Single-leader coordination using Redis key `lock:leader` with 10s TTL (`SET NX PX`).
  - Periodic heartbeat renewal every 3s via atomic Lua script verifying ownership before extending TTL (`pexpire`).
  - Safe lock release upon shutdown via atomic Lua delete verifying instance identity.
  - Dynamic lifecycle callbacks (`onAcquired`, `onLost`) that start and stop the poller loop on state transitions.
- **Authoritative Submission Poller (`PollerService`):**
  - In-memory registry mapping active player handles (`handleNorm`) to their active match questions, problem contest ID/index, baseline submission ID, start time, deadline, and pending submissions map.
  - Main polling cycle runs every 5s (`intervalMs = 5000`) on the normal priority lane via `recentStatus(1000)`.
  - Polling cycle is skipped entirely when the registry is empty to preserve rate limit budget.
  - **Gap Detection & Recovery:** Detects if `oldestIdInBatch > maxSeenSubmissionId` (indicating high-traffic CF burst overflowed the 1,000 recent status window) and triggers targeted `user.status(handle, 1, 10)` fallback for all currently active match players.
  - **Strict Eligibility Filtering:**
    - Rejects submissions with ID $\le baselineId$.
    - Rejects submissions for different problems or by authors not in the active registry.
    - Applies a 3-second clock-skew buffer (`startedAtMs - startSlackMs`) allowing submissions slightly before server-registered question start.
    - Rejects submissions created after the question's deadline.
    - Dispatches final verdicts (`OK`, `WRONG_ANSWER`, `TIME_LIMIT_EXCEEDED`, etc.) at most once per submission ID using `processedSubmissions` set.
  - **Pending Submission Resolution:**
    - Non-final verdicts (`TESTING`, `SUBMITTED`, etc.) tracked in `entry.pending`.
    - Dedicated 3s recheck loop queries `user.status` to resolve pending verdicts to final status.
  - **Player Submission Hint:**
    - Invoked when player clicks submit or emits `match:submitted`.
    - Protected by a 5-second per-user cooldown.
    - Enqueues high-priority `user.status(handle, 1, 5, 'high')` check to deliver near-instant verdict feedback without waiting for the next 5s cycle.
- **Verification CLI Tool (`pnpm poller:try`):**
  - Monitors real submissions on live Codeforces across two handles on a designated problem.
  - Automatically queries baselines for both handles and prints live detection events with elapsed time and end-to-end detection latency in seconds.
