# Duel

Duel is a real-time 1v1 competitive programming platform where two players compete head-to-head on Codeforces problem sheets. The system tracks submissions through public Codeforces polling, computes dynamic time-decay scores with wrong-submission penalties, and maintains authoritative Elo ratings and leaderboards.

---

## Match Mechanics

1. **Format and Sheets**: Matches consist of 3 to 5 problems chosen from ranked level sheets (L1 Warm-up through L6 Master, spanning Codeforces ratings 800 to 2400).
2. **Problem Selection**: A deterministic picker selects problems spaced evenly across the sheet's rating range. Problems already solved by either player or encountered in either player's recent 50 matches are automatically excluded.
3. **Decaying Scoring**: Each question starts at 1,000 points and decays non-linearly to a 150-point floor as the timer elapses. An accepted solution awards the current points plus a 100-point bonus for the first player to solve. Incorrect submissions incur a 50-point deduction.
4. **Autonomous Polling**: Contestants do not submit code through Duel. They submit directly on Codeforces. A server-side poller continuously monitors participant handles, verifies submission timestamps, and updates match state in real time.
5. **Circuit Breakers & Degradation**: If the Codeforces API experiences downtime or 5xx errors, the circuit breaker enters a degraded state, match timers are paused, and question deadlines are extended by the exact outage duration once connectivity recovers.
6. **Elo Ratings**: Ratings update immediately upon match completion using standard logistic Elo equations with dynamic K-factors ($K=40$ for provisional players under 10 matches, $K=24$ for established players). Repeated pairings within 24 hours receive halved rating adjustments to prevent rating manipulation.

---

## Repository Structure

The project is structured as a TypeScript monorepo managed with `pnpm` workspaces:

```text
duel/
├── apps/
│   ├── api/          # Express REST API, Socket.IO gateway, Prisma ORM, BullMQ
│   └── web/          # React 19 SPA, Vite, Tailwind CSS, Zustand client store
├── packages/
│   ├── cf-client/    # Token-bucket rate-limited Codeforces client & fake CF server
│   └── shared/       # Pure scoring algorithms, Elo formulas, Zod validation schemas
├── deploy/           # Nginx reverse proxy, Postgres init scripts, backup tasks
├── docs/             # Decision logs and architectural documentation
└── docker-compose.yml
```

### Key Components

- **`apps/api`**: Houses authentication, handle verification (via compiler error challenge), match state machine, Redis leader-locked submission poller, and Prometheus metric exporters.
- **`apps/web`**: Single-page application including the real-time match arena, matchmaking queue with expanding Elo windows, user profile with rating sparklines, global/sheet leaderboards, and an administrative moderation dashboard.
- **`packages/shared`**: Shared TypeScript types, pure scoring and Elo math shared between client and server, and request/response validation schemas.
- **`packages/cf-client`**: Standalone client implementing priority queue lanes (`high`, `normal`, `low`), backoff retry policies, and an in-memory mock Codeforces server for automated testing without live network calls.

---

## Getting Started

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **Docker** and **Docker Compose** (for PostgreSQL and Redis)

### Installation

1. Clone the repository:

   ```bash
   git clone git@github.com:harshprakash007/duel.git
   cd duel
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Set up the local environment configuration:

   ```bash
   cp .env.example .env
   ```

4. Start backing services (PostgreSQL 16 on port `5435`, Redis 7 on port `6385`):

   ```bash
   pnpm infra:up
   ```

5. Run database migrations and seed default sheets and admin credentials:

   ```bash
   pnpm --filter @duel/api exec prisma migrate dev
   pnpm --filter @duel/api exec prisma db seed
   ```

   _Default administrator credentials:_ `admin@duel.local` / `AdminPass123!`

6. Start local development servers:

   ```bash
   pnpm dev
   ```

   - Web application: `http://localhost:5173`
   - API server: `http://localhost:4000`
   - Health check: `http://localhost:4000/healthz`
   - Prometheus metrics: `http://localhost:4000/metrics`

---

## Configuration

Core environment variables defined in `.env`:

| Variable           | Description                                        | Default                                         |
| ------------------ | -------------------------------------------------- | ----------------------------------------------- |
| `PORT`             | API server HTTP port                               | `4000`                                          |
| `DATABASE_URL`     | PostgreSQL connection string                       | `postgresql://duel:duel@localhost:5435/duel`    |
| `REDIS_URL`        | Redis connection string                            | `redis://localhost:6385`                        |
| `JWT_SECRET`       | Secret key for HS256 authentication cookies        | _(Set to a secure 32+ character random string)_ |
| `CORS_ORIGIN`      | Allowed client origin for CORS and CSRF protection | `http://localhost:5173`                         |
| `CF_USER_AGENT`    | Contact string sent in Codeforces API headers      | `Duel/0.1 (contact: admin@example.com)`         |
| `CF_BASE_URL`      | Codeforces API endpoint                            | `https://codeforces.com/api`                    |
| `POLL_INTERVAL_MS` | Base submission polling interval                   | `5000`                                          |

---

## Testing

The test suite covers unit logic, integration workflows, chaos resilience, and concurrent load:

```bash
# Run unit tests across all workspaces
pnpm test

# Run all integration test suites against test database (duel_test)
pnpm test:int

# Run TypeScript typechecks
pnpm typecheck

# Run ESLint and Prettier checks
pnpm lint
pnpm format:check

# Run production build
pnpm build
```

### Integration Test Matrix

- **Authentication & Handles**: `auth.test.ts`, `handles.test.ts`
- **Catalog & Selection**: `catalog.test.ts`
- **Matchmaking & Engine**: `matchmaking.test.ts`, `match-engine.test.ts`, `ready.test.ts`
- **Submission Poller**: `poller.test.ts`
- **Ratings & Leaderboard**: `ratings.test.ts`
- **Production Hardening**: `hardening.test.ts` (account deletion, reporting, rating rollback)
- **Chaos Resilience**: `chaos.test.ts` (mid-match crash recovery, Codeforces degradation pause)
- **Load & Latency**: `load.test.ts` (20-client concurrent matches, verifying p95 latency < 300ms)

---

## Deployment

A complete production stack can be run locally or on a VPS via Docker Compose:

```bash
docker compose --profile app up -d --build
```

This starts:

- **`web`**: Nginx container serving the compiled React SPA, terminating client requests, and proxying `/api` and `/socket.io` (with WebSocket upgrade headers).
- **`api`**: Production Node.js container running database migrations and the API server.
- **`postgres`**: PostgreSQL database with persistent volume storage.
- **`redis`**: Redis instance with append-only file persistence.
- **`backup`**: Cron-like worker performing daily database backups via `pg_dump`.

The application is exposed on port `8080` (e.g., `http://localhost:8080`).

---

## Observability & Admin Moderation

- **Prometheus Metrics**: Exported at `GET /metrics` in standard exposition format, tracking active match counts, open WebSocket connections, matchmaking queue wait times, and poller detection lag.
- **Abuse Reports**: Players can report suspicious matches for review. Admins can inspect open reports at `/admin` and dismiss, resolve, or void matches.
- **Match Voiding**: Voiding a match automatically performs compensating rating adjustments, records reversal history entries, and regenerates leaderboards.
- **Data Privacy**: Users can trigger self-service account deletion from their profile page. Account details are scrubbed, linked Codeforces handles and solved records are purged, and historical matches are retained under an anonymous identifier to preserve competitor history.

---

## Legal & Disclaimer

Duel is an independent competitive platform and is not affiliated with, authorized, or endorsed by Codeforces. All problem statements, problem metadata, and author copyrights belong to Codeforces and their respective authors.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
