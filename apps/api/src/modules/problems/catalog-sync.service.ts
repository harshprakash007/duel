import type { Db } from '../../db/prisma';
import type { CfClient } from '@duel/cf-client';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';

export interface SyncResult {
  totalReceived: number;
  upsertedCount: number;
  deactivatedCount: number;
  durationMs: number;
}

export class CatalogSyncService {
  private isSyncing = false;

  constructor(
    private readonly db: Db,
    private readonly cfClient: CfClient,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  public async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new AppError('CONFLICT', 'Catalog sync already in progress');
    }

    this.isSyncing = true;
    const startTime = Date.now();
    this.logger.info('Starting problem catalog sync from Codeforces');

    try {
      const data = await this.cfClient.problemsetProblems({ lane: 'low' });
      const statsMap = new Map<string, number>();
      for (const s of data.problemStatistics) {
        if (s.contestId !== undefined) {
          statsMap.set(`${s.contestId}-${s.index.toUpperCase()}`, s.solvedCount);
        }
      }

      const excludeSet = new Set(this.config.catalog.excludeTags.map((t) => t.toLowerCase()));
      const now = new Date();
      const validProblems: Array<{
        contestId: number;
        index: string;
        name: string;
        rating: number;
        tags: string[];
        solvedCount: number;
        isActive: boolean;
        syncedAt: Date;
      }> = [];

      for (const p of data.problems) {
        if (p.contestId === undefined || p.rating === undefined) continue;
        if (p.type && p.type !== 'PROGRAMMING') continue;

        const hasExcludedTag = p.tags.some((t) => excludeSet.has(t.toLowerCase()));
        if (hasExcludedTag) continue;

        const key = `${p.contestId}-${p.index.toUpperCase()}`;
        const solvedCount = statsMap.get(key) ?? 0;

        validProblems.push({
          contestId: p.contestId,
          index: p.index.toUpperCase(),
          name: p.name,
          rating: p.rating,
          tags: p.tags,
          solvedCount,
          isActive: true,
          syncedAt: now,
        });
      }

      // Upsert in chunks of 500 to maintain optimal transaction performance
      const chunkSize = 500;
      let upsertedCount = 0;

      for (let i = 0; i < validProblems.length; i += chunkSize) {
        const chunk = validProblems.slice(i, i + chunkSize);
        await this.db.$transaction(
          chunk.map((item) =>
            this.db.problem.upsert({
              where: {
                contestId_index: {
                  contestId: item.contestId,
                  index: item.index,
                },
              },
              update: {
                name: item.name,
                rating: item.rating,
                tags: item.tags,
                solvedCount: item.solvedCount,
                isActive: true,
                syncedAt: item.syncedAt,
              },
              create: item,
            }),
          ),
        );
        upsertedCount += chunk.length;
      }

      // Mark problems that disappeared as inactive
      const deactivationResult = await this.db.problem.updateMany({
        where: {
          syncedAt: { lt: now },
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          totalReceived: data.problems.length,
          upsertedCount,
          deactivatedCount: deactivationResult.count,
          durationMs,
        },
        'Catalog sync completed successfully',
      );

      return {
        totalReceived: data.problems.length,
        upsertedCount,
        deactivatedCount: deactivationResult.count,
        durationMs,
      };
    } finally {
      this.isSyncing = false;
    }
  }
}
