import type { Db } from '../../db/prisma';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import { calculateMatchEloDeltas, type MatchOutcome, type MatchEloResult } from '@duel/shared';
import type { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/errors';

export interface FinalizedMatchRatings {
  ratings: Record<string, { before: number; after: number; delta: number }>;
  eloResult: MatchEloResult;
  userAId: string;
  userBId: string;
  newMatchesA: number;
  newMatchesB: number;
}

export class RatingsService {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  /**
   * Authoritatively updates player ratings inside a database transaction
   * using deadlock-free row locking (`ORDER BY "userId" ASC FOR UPDATE`).
   */
  public async finalizeMatchRatingsInTx(
    matchId: string,
    sheetId: string,
    playerResults: Record<string, 'WIN' | 'LOSS' | 'DRAW' | null>,
    scores: Record<string, number>,
    tx: Prisma.TransactionClient,
  ): Promise<FinalizedMatchRatings | null> {
    const matchPlayers = await tx.matchPlayer.findMany({
      where: { matchId },
    });

    if (matchPlayers.length !== 2) {
      this.logger.warn(
        { matchId, count: matchPlayers.length },
        'Cannot finalize ratings: expected exactly 2 players',
      );
      return null;
    }

    const pA = matchPlayers[0];
    const pB = matchPlayers[1];
    if (!pA || !pB) {
      return null;
    }

    const sortedUserIds = [pA.userId, pB.userId].sort();
    const user0 = sortedUserIds[0]!;
    const user1 = sortedUserIds[1]!;

    // 1. Deadlock-free locking: acquire database locks in consistent alphabetical userId order
    await tx.$queryRaw`
      SELECT "userId" FROM "PlayerRating"
      WHERE "userId" IN (${user0}::uuid, ${user1}::uuid)
      ORDER BY "userId" ASC
      FOR UPDATE
    `;

    // 2. Fetch or create PlayerRating records
    let ratingA = await tx.playerRating.findUnique({ where: { userId: pA.userId } });
    if (!ratingA) {
      ratingA = await tx.playerRating.create({
        data: {
          userId: pA.userId,
          rating: this.config.ratingInit.fallback,
          peakRating: this.config.ratingInit.fallback,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        },
      });
    }

    let ratingB = await tx.playerRating.findUnique({ where: { userId: pB.userId } });
    if (!ratingB) {
      ratingB = await tx.playerRating.create({
        data: {
          userId: pB.userId,
          rating: this.config.ratingInit.fallback,
          peakRating: this.config.ratingInit.fallback,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        },
      });
    }

    const resA = (playerResults[pA.userId] ?? 'DRAW') as MatchOutcome;
    const resB = (playerResults[pB.userId] ?? 'DRAW') as MatchOutcome;

    // 3. Anti-farming check (§13): check count of ranked matches between these 2 players in the last 24h
    const cutoff = new Date(Date.now() - this.config.elo.repeatPairWindowMs);
    const pastMatchesCount = await tx.match.count({
      where: {
        id: { not: matchId },
        mode: 'RANKED',
        status: 'FINISHED',
        createdAt: { gte: cutoff },
        AND: [
          { players: { some: { userId: pA.userId } } },
          { players: { some: { userId: pB.userId } } },
        ],
      },
    });

    const isFarmingSuspect = pastMatchesCount >= this.config.elo.repeatPairThreshold;
    if (isFarmingSuspect) {
      this.logger.info(
        { matchId, userA: pA.userId, userB: pB.userId, pastMatchesCount },
        'Anti-farming protection triggered: K-factor halved',
      );
    }

    // 4. Calculate pure Elo deltas
    const eloResult = calculateMatchEloDeltas(
      {
        rating: ratingA.rating,
        matchesPlayed: ratingA.matchesPlayed,
        result: resA,
      },
      {
        rating: ratingB.rating,
        matchesPlayed: ratingB.matchesPlayed,
        result: resB,
      },
      {
        isFarmingSuspect,
        peakRatingA: ratingA.peakRating,
        peakRatingB: ratingB.peakRating,
        params: this.config.elo,
      },
    );

    // 5. Update PlayerRating in DB
    await tx.playerRating.update({
      where: { userId: pA.userId },
      data: {
        rating: eloResult.playerA.newRating,
        peakRating: eloResult.playerA.peakRating,
        matchesPlayed: { increment: 1 },
        wins: resA === 'WIN' ? { increment: 1 } : undefined,
        losses: resA === 'LOSS' ? { increment: 1 } : undefined,
        draws: resA === 'DRAW' ? { increment: 1 } : undefined,
      },
    });

    await tx.playerRating.update({
      where: { userId: pB.userId },
      data: {
        rating: eloResult.playerB.newRating,
        peakRating: eloResult.playerB.peakRating,
        matchesPlayed: { increment: 1 },
        wins: resB === 'WIN' ? { increment: 1 } : undefined,
        losses: resB === 'LOSS' ? { increment: 1 } : undefined,
        draws: resB === 'DRAW' ? { increment: 1 } : undefined,
      },
    });

    // 6. Update MatchPlayer records
    await tx.matchPlayer.update({
      where: { matchId_userId: { matchId, userId: pA.userId } },
      data: {
        totalScore: scores[pA.userId] ?? pA.totalScore,
        result: resA,
        ratingAfter: eloResult.playerA.newRating,
      },
    });

    await tx.matchPlayer.update({
      where: { matchId_userId: { matchId, userId: pB.userId } },
      data: {
        totalScore: scores[pB.userId] ?? pB.totalScore,
        result: resB,
        ratingAfter: eloResult.playerB.newRating,
      },
    });

    // 7. Insert RatingHistory records
    await tx.ratingHistory.createMany({
      data: [
        {
          userId: pA.userId,
          matchId,
          before: ratingA.rating,
          after: eloResult.playerA.newRating,
          delta: eloResult.playerA.delta,
        },
        {
          userId: pB.userId,
          matchId,
          before: ratingB.rating,
          after: eloResult.playerB.newRating,
          delta: eloResult.playerB.delta,
        },
      ],
    });

    return {
      ratings: {
        [pA.userId]: {
          before: ratingA.rating,
          after: eloResult.playerA.newRating,
          delta: eloResult.playerA.delta,
        },
        [pB.userId]: {
          before: ratingB.rating,
          after: eloResult.playerB.newRating,
          delta: eloResult.playerB.delta,
        },
      },
      eloResult,
      userAId: pA.userId,
      userBId: pB.userId,
      newMatchesA: ratingA.matchesPlayed + 1,
      newMatchesB: ratingB.matchesPlayed + 1,
    };
  }

  /**
   * Applies post-finalization updates to Redis leaderboards (lb:global, lb:sheet:{sheetId}).
   */
  public async applyPostFinalizeRedis(
    finalized: FinalizedMatchRatings,
    sheetId: string,
    winnerUserId?: string | null,
  ): Promise<void> {
    const { userAId, userBId, newMatchesA, newMatchesB, ratings } = finalized;
    const minMatches = this.config.leaderboard.minRankedMatches;

    const pipeline = this.redis.pipeline();

    // Only players with >= minRankedMatches qualify for global leaderboard (§13)
    const ratingA = ratings[userAId];
    const ratingB = ratings[userBId];
    if (newMatchesA >= minMatches && ratingA) {
      pipeline.zadd('lb:global', ratingA.after, userAId);
    }
    if (newMatchesB >= minMatches && ratingB) {
      pipeline.zadd('lb:global', ratingB.after, userBId);
    }

    // Winner gains 1 win on the level sheet leaderboard
    if (winnerUserId) {
      pipeline.zincrby(`lb:sheet:${sheetId}`, 1, winnerUserId);
    }

    await pipeline.exec();
  }

  /**
   * Authoritatively rebuilds Redis leaderboards from Postgres.
   */
  public async rebuildLeaderboards(): Promise<void> {
    this.logger.info('Rebuilding leaderboards in Redis from database');
    const minMatches = this.config.leaderboard.minRankedMatches;

    const qualifiedRatings = await this.db.playerRating.findMany({
      where: {
        matchesPlayed: { gte: minMatches },
      },
      select: { userId: true, rating: true },
    });

    const pipeline = this.redis.pipeline();
    pipeline.del('lb:global');
    for (const r of qualifiedRatings) {
      pipeline.zadd('lb:global', r.rating, r.userId);
    }

    const sheets = await this.db.levelSheet.findMany({ select: { id: true } });
    for (const s of sheets) {
      pipeline.del(`lb:sheet:${s.id}`);
    }

    const rawSheetWins = await this.db.$queryRaw<
      Array<{ sheetId: string; userId: string; wins: number }>
    >`
      SELECT m."sheetId"::text as "sheetId", mp."userId"::text as "userId", COUNT(*)::int as wins
      FROM "MatchPlayer" mp
      JOIN "Match" m ON m.id = mp."matchId"
      WHERE mp.result = 'WIN' AND m.mode = 'RANKED' AND m.status = 'FINISHED'
      GROUP BY m."sheetId", mp."userId"
    `;

    for (const sw of rawSheetWins) {
      pipeline.zadd(`lb:sheet:${sw.sheetId}`, sw.wins, sw.userId);
    }

    await pipeline.exec();
    this.logger.info(
      { globalCount: qualifiedRatings.length, sheetsCount: sheets.length },
      'Leaderboards rebuild complete',
    );
  }

  /**
   * Authoritatively voids a match.
   * If the match was ranked and ratings were changed, reverses rating deltas atomically
   * and resyncs the leaderboards.
   */
  public async voidMatchRatings(
    matchId: string,
  ): Promise<{ ok: boolean; reversed: boolean; message: string }> {
    const match = await this.db.match.findUnique({
      where: { id: matchId },
      include: {
        players: true,
        ratingHistory: true,
      },
    });

    if (!match) {
      throw new AppError('NOT_FOUND', 'Match not found');
    }

    if (match.endReason === 'VOIDED') {
      return { ok: true, reversed: false, message: 'Match is already voided' };
    }

    const hasRankedHistory = match.mode === 'RANKED' && match.ratingHistory.length === 2;

    if (hasRankedHistory) {
      const sortedUserIds = match.players.map((p) => p.userId).sort();
      const user0 = sortedUserIds[0]!;
      const user1 = sortedUserIds[1]!;

      await this.db.$transaction(async (tx) => {
        // 1. Acquire row locks in consistent alphabetical order
        await tx.$queryRaw`
          SELECT "userId" FROM "PlayerRating"
          WHERE "userId" IN (${user0}::uuid, ${user1}::uuid)
          ORDER BY "userId" ASC FOR UPDATE
        `;

        for (const rh of match.ratingHistory) {
          const pr = await tx.playerRating.findUnique({
            where: { userId: rh.userId },
          });

          if (pr) {
            const mp = match.players.find((p) => p.userId === rh.userId);
            const isWin = mp?.result === 'WIN';
            const isLoss = mp?.result === 'LOSS';
            const isDraw = mp?.result === 'DRAW';

            // Revert delta
            const newRating = Math.max(this.config.elo.floor, pr.rating - rh.delta);
            const matchesPlayed = Math.max(0, pr.matchesPlayed - 1);
            const wins = isWin ? Math.max(0, pr.wins - 1) : pr.wins;
            const losses = isLoss ? Math.max(0, pr.losses - 1) : pr.losses;
            const draws = isDraw ? Math.max(0, pr.draws - 1) : pr.draws;

            await tx.playerRating.update({
              where: { userId: rh.userId },
              data: {
                rating: newRating,
                matchesPlayed,
                wins,
                losses,
                draws,
              },
            });

            // Insert compensating rating history record
            await tx.ratingHistory.create({
              data: {
                userId: rh.userId,
                matchId,
                before: pr.rating,
                after: newRating,
                delta: -rh.delta,
              },
            });
          }
        }

        await tx.match.update({
          where: { id: matchId },
          data: {
            status: 'ABORTED',
            endReason: 'VOIDED',
          },
        });
      });

      // Resync Redis leaderboards
      await this.rebuildLeaderboards();

      this.logger.info({ matchId }, 'Match voided and ratings reversed');
      return { ok: true, reversed: true, message: 'Match voided and ratings reversed' };
    } else {
      // Unranked, or aborted match without rating deltas
      await this.db.match.update({
        where: { id: matchId },
        data: {
          status: 'ABORTED',
          endReason: 'VOIDED',
        },
      });

      this.logger.info({ matchId }, 'Match voided without rating adjustments');
      return { ok: true, reversed: false, message: 'Match voided (unrated or already aborted)' };
    }
  }
}
