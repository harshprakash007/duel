import type { Db } from '../../db/prisma';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import {
  type LeaderboardEntryDto,
  type LeaderboardQuery,
  type LeaderboardResponseDto,
  type UserRankDto,
} from '@duel/shared';
import { AppError } from '../../lib/errors';

export class LeaderboardService {
  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly config: Config,
  ) {}

  public async getLeaderboard(
    query: LeaderboardQuery,
    viewerUserId?: string,
  ): Promise<LeaderboardResponseDto> {
    const scope = query.scope;
    let key: string;
    let sheetSlug: string | undefined;

    if (scope === 'sheet') {
      if (!query.sheet) {
        throw new AppError('BAD_REQUEST', 'sheet parameter is required when scope is "sheet"');
      }

      // Check if query.sheet matches slug or id
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        query.sheet,
      );
      const sheet = await this.db.levelSheet.findFirst({
        where: {
          OR: [{ slug: query.sheet }, ...(isUuid ? [{ id: query.sheet }] : [])],
        },
      });

      if (!sheet) {
        throw new AppError('NOT_FOUND', `Sheet not found: ${query.sheet}`);
      }

      sheetSlug = sheet.slug;
      key = `lb:sheet:${sheet.id}`;
    } else {
      key = 'lb:global';
    }

    const total = await this.redis.zcard(key);
    const limit = query.limit;
    const offset = query.offset;

    let myRank: UserRankDto | null = null;
    if (viewerUserId) {
      myRank = await this.getUserRank(key, viewerUserId);
    }

    if (total === 0 || offset >= total) {
      return {
        scope,
        sheetSlug,
        entries: [],
        total,
        myRank,
      };
    }

    // Redis ZREVRANGE with scores: [member1, score1, member2, score2, ...]
    const rawRange = await this.redis.zrevrange(key, offset, offset + limit - 1, 'WITHSCORES');
    const userIds: string[] = [];
    const scoresMap = new Map<string, number>();

    for (let i = 0; i < rawRange.length; i += 2) {
      const uid = rawRange[i];
      const scStr = rawRange[i + 1];
      if (!uid || scStr === undefined) continue;
      const sc = parseInt(scStr, 10);
      userIds.push(uid);
      scoresMap.set(uid, isNaN(sc) ? 0 : sc);
    }

    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      include: {
        handle: true,
        rating: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const entries: LeaderboardEntryDto[] = [];
    for (let i = 0; i < userIds.length; i++) {
      const uid = userIds[i];
      if (!uid) continue;
      const u = userMap.get(uid);
      const score = scoresMap.get(uid) ?? 0;

      entries.push({
        rank: offset + i + 1,
        userId: uid,
        handle: u?.handle?.handle ?? u?.displayName ?? 'Anonymous',
        rating: scope === 'global' ? score : (u?.rating?.rating ?? 1000),
        wins: scope === 'sheet' ? score : (u?.rating?.wins ?? 0),
        matchesPlayed: u?.rating?.matchesPlayed ?? 0,
      });
    }

    return {
      scope,
      sheetSlug,
      entries,
      total,
      myRank,
    };
  }

  public async getUserRank(key: string, userId: string): Promise<UserRankDto | null> {
    const [rank, scoreStr] = await Promise.all([
      this.redis.zrevrank(key, userId),
      this.redis.zscore(key, userId),
    ]);

    if (rank === null || scoreStr === null) {
      return null;
    }

    const score = parseInt(scoreStr, 10);
    return {
      rank: rank + 1,
      score: isNaN(score) ? 0 : score,
    };
  }
}
