import { Queue, Worker } from 'bullmq';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import type { CatalogSyncService } from './catalog-sync.service';

export class CatalogSyncQueue {
  private queue: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: Redis,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly catalogSyncService: CatalogSyncService,
  ) {
    this.queue = new Queue('catalog-sync', {
      connection: redis,
    });
  }

  public async start(): Promise<void> {
    if (!this.config.catalog.jobsEnabled) {
      this.logger.info('Catalog sync background jobs disabled by config');
      return;
    }

    try {
      await this.queue.upsertJobScheduler(
        'catalog-sync-daily',
        { pattern: this.config.catalog.syncCron },
        { name: 'sync-problems' },
      );
    } catch (err) {
      this.logger.warn({ err }, 'Could not register catalog-sync job scheduler');
    }

    const workerRedis = this.redis.duplicate();
    this.worker = new Worker(
      'catalog-sync',
      async () => {
        this.logger.info('Running scheduled catalog sync');
        return await this.catalogSyncService.sync();
      },
      {
        connection: workerRedis,
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Catalog sync worker job failed');
    });

    this.worker.on('completed', (job) => {
      this.logger.info({ jobId: job?.id }, 'Catalog sync worker job completed');
    });
  }

  public async trigger(): Promise<void> {
    await this.queue.add('sync-problems', {});
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await this.queue.close();
  }
}
