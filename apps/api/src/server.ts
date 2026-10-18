import { createServer, type Server } from 'node:http';
import type { Config } from './config/index';
import { createApp } from './app';
import { createLogger, type Logger } from './lib/logger';
import { createMetrics } from './lib/metrics';
import { createPrisma } from './db/prisma';
import { createRedis } from './db/redis';

export interface RunningServer {
  server: Server;
  logger: Logger;
  port: number;
  close: () => Promise<void>;
}

/** Composition root: wires every module together and starts listening. */
export async function startServer(config: Config): Promise<RunningServer> {
  const logger = createLogger(config);
  const metrics = createMetrics();
  const prisma = createPrisma(config.databaseUrl);
  const redis = createRedis(config.redisUrl);

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
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    })());

  return { server, logger, port, close };
}
