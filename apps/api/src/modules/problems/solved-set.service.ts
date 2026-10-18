import type { Db } from '../../db/prisma';
import type { CfClient } from '@duel/cf-client';
import type { Logger } from '../../lib/logger';

export class SolvedSetService {
  constructor(
    private readonly db: Db,
    private readonly cfClient: CfClient,
    private readonly logger: Logger,
  ) {}

  public async syncUserSolved(userId: string, handle: string): Promise<number> {
    const cfHandle = await this.db.cfHandle.findUnique({
      where: { userId },
      select: { solvedSyncedUpToId: true },
    });

    const upToId = cfHandle?.solvedSyncedUpToId ?? null;
    let from = 1;
    const batchSize = 100;
    let newestSeenId: bigint | null = null;
    const solvedToInsert: Array<{ userId: string; contestId: number; index: string }> = [];

    while (true) {
      const subs = await this.cfClient.userStatus(handle, from, batchSize, 'low');
      if (subs.length === 0) break;

      for (const s of subs) {
        if (newestSeenId === null) {
          newestSeenId = s.id;
        }

        // Reached previously synced mark
        if (upToId !== null && s.id <= upToId) {
          break;
        }

        if (s.verdict === 'OK' && s.problem.contestId !== undefined) {
          solvedToInsert.push({
            userId,
            contestId: s.problem.contestId,
            index: s.problem.index.toUpperCase(),
          });
        }
      }

      // Check if we hit the stop condition in this batch
      const hitStop = upToId !== null && subs.some((s) => s.id <= upToId);
      if (hitStop || subs.length < batchSize) {
        break;
      }

      from += batchSize;
    }

    // Insert newly solved problems
    if (solvedToInsert.length > 0) {
      await this.db.userSolved.createMany({
        data: solvedToInsert,
        skipDuplicates: true,
      });
    }

    const finalUpToId =
      upToId !== null && newestSeenId !== null
        ? newestSeenId > upToId
          ? newestSeenId
          : upToId
        : (newestSeenId ?? upToId);

    await this.db.cfHandle.update({
      where: { userId },
      data: {
        ...(finalUpToId !== null ? { solvedSyncedUpToId: finalUpToId } : {}),
        solvedSyncedAt: new Date(),
      },
    });

    this.logger.debug({ userId, handle, count: solvedToInsert.length }, 'User solved-set synced');

    return solvedToInsert.length;
  }
}
