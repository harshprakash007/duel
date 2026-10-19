import type { Db } from '../../db/prisma';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import {
  type UserMatchesQuery,
  type UserMatchesResponseDto,
  type UserMatchSummaryDto,
  type UserProfileDto,
} from '@duel/shared';
import { AppError } from '../../lib/errors';

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly config: Config,
  ) {}

  public async getUserProfile(handle: string): Promise<UserProfileDto> {
    const handleNorm = handle.toLowerCase().trim();

    const cfHandle = await this.db.cfHandle.findUnique({
      where: { handleNorm },
      include: {
        user: {
          include: {
            rating: true,
          },
        },
      },
    });

    if (!cfHandle) {
      throw new AppError('NOT_FOUND', `User with handle "${handle}" not found`);
    }

    const user = cfHandle.user;
    const rating = user.rating;

    const matchesPlayed = rating?.matchesPlayed ?? 0;
    const wins = rating?.wins ?? 0;
    const losses = rating?.losses ?? 0;
    const draws = rating?.draws ?? 0;
    const winRate = matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 1000) / 10 : 0;

    // Discover global rank in Redis ZSET
    const rank = await this.redis.zrevrank('lb:global', user.id);
    const globalRank = rank !== null ? rank + 1 : null;

    // Fetch up to 20 most recent rating history points
    const history = await this.db.ratingHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Chronological order for sparklines
    const ratingHistory = history.reverse().map((h) => ({
      matchId: h.matchId,
      before: h.before,
      after: h.after,
      delta: h.delta,
      createdAt: h.createdAt.toISOString(),
    }));

    return {
      userId: user.id,
      handle: cfHandle.handle,
      displayName: user.displayName,
      verifiedAt: cfHandle.verifiedAt.toISOString(),
      cfRatingAtLink: cfHandle.cfRatingAtLink,
      rating: rating?.rating ?? this.config.ratingInit.fallback,
      peakRating: rating?.peakRating ?? this.config.ratingInit.fallback,
      matchesPlayed,
      wins,
      losses,
      draws,
      winRate,
      globalRank,
      ratingHistory,
    };
  }

  public async getUserMatches(
    handle: string,
    query: UserMatchesQuery,
  ): Promise<UserMatchesResponseDto> {
    const handleNorm = handle.toLowerCase().trim();

    const cfHandle = await this.db.cfHandle.findUnique({
      where: { handleNorm },
      select: { userId: true },
    });

    if (!cfHandle) {
      throw new AppError('NOT_FOUND', `User with handle "${handle}" not found`);
    }

    const userId = cfHandle.userId;

    const total = await this.db.matchPlayer.count({
      where: {
        userId,
        match: {
          status: { in: ['FINISHED', 'ABORTED'] },
        },
      },
    });

    if (total === 0 || query.offset >= total) {
      return { matches: [], total };
    }

    const matchPlayers = await this.db.matchPlayer.findMany({
      where: {
        userId,
        match: {
          status: { in: ['FINISHED', 'ABORTED'] },
        },
      },
      include: {
        match: {
          include: {
            sheet: true,
            players: {
              include: {
                user: {
                  include: {
                    handle: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        match: {
          createdAt: 'desc',
        },
      },
      take: query.limit,
      skip: query.offset,
    });

    const matches: UserMatchSummaryDto[] = matchPlayers.map((mp) => {
      const opp = mp.match.players.find((p) => p.userId !== userId);
      const opponent = opp
        ? {
            userId: opp.userId,
            handle: opp.user?.handle?.handle ?? opp.handleNorm,
            rating: opp.ratingBefore,
          }
        : null;

      return {
        matchId: mp.match.id,
        mode: mp.match.mode,
        sheetSlug: mp.match.sheet.slug,
        sheetName: mp.match.sheet.name,
        createdAt: mp.match.createdAt.toISOString(),
        finishedAt: mp.match.finishedAt?.toISOString() ?? null,
        endReason: mp.match.endReason,
        opponent,
        result: mp.result,
        score: mp.totalScore,
        opponentScore: opp?.totalScore ?? 0,
        ratingBefore: mp.ratingBefore,
        ratingAfter: mp.ratingAfter,
        delta: mp.ratingAfter !== null ? mp.ratingAfter - mp.ratingBefore : null,
        questionCount: mp.match.questionCount,
      };
    });

    return { matches, total };
  }
}
