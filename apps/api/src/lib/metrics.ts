import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** All §18 metrics, on a per-process registry (so tests can create isolated instances). */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const m = {
    registry,
    cfRequestsTotal: new Counter({
      name: 'cf_requests_total',
      help: 'Codeforces API requests',
      labelNames: ['endpoint', 'status'] as const,
      registers: [registry],
    }),
    cfRequestSeconds: new Histogram({
      name: 'cf_request_seconds',
      help: 'Codeforces API request latency',
      labelNames: ['endpoint'] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [registry],
    }),
    cfQueueDepth: new Gauge({
      name: 'cf_queue_depth',
      help: 'Codeforces requests waiting for a limiter token',
      labelNames: ['lane'] as const,
      registers: [registry],
    }),
    pollerCycleSeconds: new Histogram({
      name: 'poller_cycle_seconds',
      help: 'Duration of a poller cycle',
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [registry],
    }),
    pollerDetectionLagSeconds: new Histogram({
      name: 'poller_detection_lag_seconds',
      help: 'Time from submission creation to final verdict detection',
      buckets: [1, 2, 5, 10, 15, 30, 60, 120],
      registers: [registry],
    }),
    activeMatches: new Gauge({
      name: 'active_matches',
      help: 'Matches currently live in the engine',
      registers: [registry],
    }),
    activeSockets: new Gauge({
      name: 'active_sockets',
      help: 'Connected Socket.IO clients',
      registers: [registry],
    }),
    matchmakingWaitSeconds: new Histogram({
      name: 'matchmaking_wait_seconds',
      help: 'Queue wait before pairing',
      buckets: [1, 5, 10, 20, 30, 60, 120, 300],
      registers: [registry],
    }),
    matchFinalizeErrorsTotal: new Counter({
      name: 'match_finalize_errors_total',
      help: 'Errors while finalizing matches',
      registers: [registry],
    }),
  };
  return m;
}

export type Metrics = ReturnType<typeof createMetrics>;
