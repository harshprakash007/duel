import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/index';
import type { Logger } from './lib/logger';
import type { Metrics } from './lib/metrics';
import { errorHandler, notFound, originCheck } from './lib/http';

export interface HealthChecks {
  db: () => Promise<void>;
  redis: () => Promise<void>;
}

export interface AppOptions {
  config: Config;
  logger: Logger;
  metrics: Metrics;
  health: HealthChecks;
  /** Routers mounted under /api, keyed by path prefix. */
  routers?: Array<[string, Router | express.RequestHandler]>;
  /** Middleware applied to every /api request before routers (e.g. rate limiter). */
  apiMiddleware?: express.RequestHandler[];
}

export function createApp(opts: AppOptions): Express {
  const { config, logger, metrics, health } = opts;
  const app = express();

  app.disable('x-powered-by');
  if (config.http.trustProxy) app.set('trust proxy', 1);
  // Codeforces submission ids are BigInt; always serialize them as strings (§4.8).
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

  app.use(helmet());
  app.use(
    cors({
      origin: config.http.corsOrigins,
      credentials: true,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/readyz', async (_req, res) => {
    const results = await Promise.allSettled([health.db(), health.redis()]);
    const [db, redis] = results.map((r) => (r.status === 'fulfilled' ? 'ok' : 'down'));
    const ok = db === 'ok' && redis === 'ok';
    res.status(ok ? 200 : 503).json({ ok, db, redis });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  const api = express.Router();
  api.use(originCheck(config.http.corsOrigins));
  for (const mw of opts.apiMiddleware ?? []) api.use(mw);
  for (const [prefix, router] of opts.routers ?? []) api.use(prefix, router);
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
