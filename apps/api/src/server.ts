import { createServer, type Server } from 'node:http';
import type { Config } from './config/index';
import { createApp } from './app';
import { createLogger, type Logger } from './lib/logger';
import { createMetrics, type Metrics } from './lib/metrics';
import { createPrisma, type Db } from './db/prisma';
import { createRedis, type Redis } from './db/redis';
import { CfClient } from '@duel/cf-client';
import { authMiddleware } from './modules/auth/auth.middleware';
import { AuthService } from './modules/auth/auth.service';
import { createAuthRouter } from './modules/auth/auth.router';
import { HandlesService } from './modules/handles/handles.service';
import { createHandlesRouter } from './modules/handles/handles.router';
import { SheetsService } from './modules/sheets/sheets.service';
import { createSheetsRouter } from './modules/sheets/sheets.router';
import { CatalogSyncService } from './modules/problems/catalog-sync.service';
import { SolvedSetService } from './modules/problems/solved-set.service';
import { PickerService } from './modules/problems/picker.service';
import { CatalogSyncQueue } from './modules/problems/catalog-sync.queue';
import { PollerService } from './modules/poller/poller.service';
import { LeaderLock } from './lib/leader-lock';
import { createAdminRouter } from './modules/admin/admin.router';
import { createRateLimiter } from './lib/rate-limiter';

export interface RunningServer {
  server: Server;
  logger: Logger;
  metrics: Metrics;
  prisma: Db;
  redis: Redis;
  cfClient: CfClient;
  authService: AuthService;
  handlesService: HandlesService;
  sheetsService: SheetsService;
  catalogSyncService: CatalogSyncService;
  solvedSetService: SolvedSetService;
  pickerService: PickerService;
  catalogSyncQueue: CatalogSyncQueue;
  pollerService: PollerService;
  leaderLock: LeaderLock;
  port: number;
  close: () => Promise<void>;
}

export interface ServerOverrides {
  cfClient?: CfClient;
  prisma?: Db;
  redis?: Redis;
}

/** Composition root: wires every module together and starts listening. */
export async function startServer(
  config: Config,
  overrides?: ServerOverrides,
): Promise<RunningServer> {
  const logger = createLogger(config);
  const metrics = createMetrics();
  const prisma = overrides?.prisma ?? createPrisma(config.databaseUrl);
  const redis = overrides?.redis ?? createRedis(config.redisUrl);

  const cfClient =
    overrides?.cfClient ??
    new CfClient({
      baseUrl: config.cf.baseUrl,
      userAgent: config.cf.userAgent,
      maxRps: config.cf.maxRps,
      timeoutMs: config.cf.timeoutMs,
      retryMax: config.cf.retryMax,
      retryBaseMs: config.cf.retryBaseMs,
      retryMaxDelayMs: config.cf.retryMaxDelayMs,
      degradedAfterFailures: config.cf.degradedAfterFailures,
      metrics: {
        onCfRequest: (endpoint, status, durationSec) => {
          metrics.cfRequestsTotal.inc({ endpoint, status });
          metrics.cfRequestSeconds.observe({ endpoint }, durationSec);
        },
        onQueueDepth: (lane, depth) => {
          metrics.cfQueueDepth.set({ lane }, depth);
        },
      },
    });

  const authService = new AuthService(prisma, config);
  const solvedSetService = new SolvedSetService(prisma, cfClient, logger);
  const handlesService = new HandlesService(prisma, cfClient, config, {
    triggerSync: async (userId, handle) => {
      await solvedSetService.syncUserSolved(userId, handle);
    },
  });
  const sheetsService = new SheetsService(prisma);
  const catalogSyncService = new CatalogSyncService(prisma, cfClient, config, logger);
  const pickerService = new PickerService(prisma, config);
  const catalogSyncQueue = new CatalogSyncQueue(redis, config, logger, catalogSyncService);
  const pollerService = new PollerService(cfClient, config, logger);

  const leaderLock = new LeaderLock({
    redis,
    instanceId: config.instanceId,
    ttlMs: config.leader.ttlMs,
    renewMs: config.leader.renewMs,
    logger,
    onAcquired: async () => {
      logger.info('Instance acquired leadership; starting poller');
      await pollerService.start();
    },
    onLost: async () => {
      logger.warn('Instance lost leadership; stopping poller');
      pollerService.stop();
    },
  });

  await catalogSyncQueue.start();

  if (!config.isTest) {
    leaderLock.startElection();
  }

  // Rate limiters
  const apiLimiter = createRateLimiter({
    windowMs: config.http.apiRateLimitWindowMs,
    max: config.http.apiRateLimitMax,
    redis,
    prefix: 'rl:api:',
  });

  const authLimiter = createRateLimiter({
    windowMs: config.auth.rateLimitWindowMs,
    max: config.auth.rateLimitMax,
    redis,
    prefix: 'rl:auth:',
  });

  const handlesLimiter = createRateLimiter({
    windowMs: 3600 * 1000,
    max: config.handles.rateLimitPerHour,
    redis,
    prefix: 'rl:handles:',
  });

  const authRouter = createAuthRouter(authService, config);
  const handlesRouter = createHandlesRouter(handlesService);
  const sheetsRouter = createSheetsRouter(sheetsService);
  const adminRouter = createAdminRouter(sheetsService, catalogSyncService);

  const app = createApp({
    config,
    logger,
    metrics,
    health: {
      db: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        await redis.ping();
      },
    },
    apiMiddleware: [apiLimiter, authMiddleware(config.auth.jwtSecret, config.auth.cookieName)],
    routers: [
      ['/auth', authLimiter],
      ['/auth', authRouter],
      ['/handles', handlesLimiter],
      ['/handles', handlesRouter],
      ['/sheets', sheetsRouter],
      ['/admin', adminRouter],
    ],
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  logger.info({ port }, 'api listening');

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      logger.info('shutting down');
      await leaderLock.stop();
      pollerService.stop();
      await catalogSyncQueue.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cfClient.destroy();
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    })());

  return {
    server,
    logger,
    metrics,
    prisma,
    redis,
    cfClient,
    authService,
    handlesService,
    sheetsService,
    catalogSyncService,
    solvedSetService,
    pickerService,
    catalogSyncQueue,
    pollerService,
    leaderLock,
    port,
    close,
  };
}
