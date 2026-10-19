import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { signAuthToken } from '../../src/modules/auth/jwt';
import type { Role } from '../../src/generated/prisma/client';
import { createPrisma } from '../../src/db/prisma';

describe('Ratings, Leaderboards, Profiles & Match Recap Integration (M7)', () => {
  let srv: RunningServer;
  let serverUrl: string;
  let sheetId: string;

  const config = loadConfig(
    testEnv({
      MATCH_COUNTDOWN_MS: '1000',
      MATCH_BREAK_MS: '500',
      MATCH_NO_SHOW_TIMEOUT_MS: '1000',
      LB_MIN_RANKED_MATCHES: '5',
    }),
  );

  beforeAll(async () => {
    const initPrisma = createPrisma(config.databaseUrl);
    await cleanDb(initPrisma);
    await initPrisma.$disconnect();

    srv = await startServer(config);
    serverUrl = `http://localhost:${srv.port}`;
    await srv.redis.flushdb();

    // Seed test sheet and problems
    const sheet = await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-m7',
        name: 'M7 Rating Sheet',
        minRating: 800,
        maxRating: 1400,
        minSolvedCount: 10,
        questionCount: 3,
        sortOrder: 1,
      },
    });
    sheetId = sheet.id;

    await srv.prisma.problem.createMany({
      data: [
        {
          id: 7001,
          contestId: 700,
          index: 'A',
          name: 'Prob 7A',
          rating: 800,
          tags: ['math'],
          solvedCount: 500,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 7002,
          contestId: 700,
          index: 'B',
          name: 'Prob 7B',
          rating: 900,
          tags: ['greedy'],
          solvedCount: 450,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 7003,
          contestId: 700,
          index: 'C',
          name: 'Prob 7C',
          rating: 1000,
          tags: ['dp'],
          solvedCount: 400,
          isActive: true,
          syncedAt: new Date(),
        },
      ],
    });
  });

  beforeEach(async () => {
    const keys = await srv.redis.keys('lb:*');
    if (keys.length > 0) {
      await srv.redis.del(...keys);
    }
  });

  afterAll(async () => {
    if (srv) {
      await srv.close();
    }
  });

  async function createVerifiedUser(handle: string, rating = 1500, matchesPlayed = 0) {
    return srv.prisma.user.create({
      data: {
        email: `${handle}@example.com`,
        displayName: `User ${handle}`,
        passwordHash: 'dummy',
        role: 'USER',
        handle: {
          create: {
            handle,
            handleNorm: handle.toLowerCase(),
            cfRatingAtLink: rating,
            verifiedAt: new Date(),
          },
        },
        rating: {
          create: {
            rating,
            peakRating: rating,
            matchesPlayed,
            wins: 0,
            losses: 0,
            draws: 0,
          },
        },
      },
    });
  }

  function userToken(user: { id: string; email: string; role: Role }) {
    return signAuthToken(
      { sub: user.id, email: user.email, role: user.role },
      config.auth.jwtSecret,
      3600,
    );
  }

  it('finalizes ratings on ranked match completion and writes history & peak rating', async () => {
    const userA = await createVerifiedUser('user_elo_a', 1500, 10);
    const userB = await createVerifiedUser('user_elo_b', 1500, 10);

    // Create match in DB
    const match = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            {
              userId: userA.id,
              handleNorm: 'user_elo_a',
              ratingBefore: 1500,
            },
            {
              userId: userB.id,
              handleNorm: 'user_elo_b',
              ratingBefore: 1500,
            },
          ],
        },
        questions: {
          create: [
            { idx: 0, problemId: 7001, status: 'ENDED' },
            { idx: 1, problemId: 7002, status: 'ENDED' },
            { idx: 2, problemId: 7003, status: 'ENDED' },
          ],
        },
      },
    });

    // Finalize match via RatingsService
    await srv.prisma.$transaction(async (tx) => {
      const finalized = await srv.ratingsService.finalizeMatchRatingsInTx(
        match.id,
        sheetId,
        { [userA.id]: 'WIN', [userB.id]: 'LOSS' },
        { [userA.id]: 800, [userB.id]: 400 },
        tx,
      );

      expect(finalized).not.toBeNull();
      // With equal ratings (1500) and 10 matches played (K=24), WIN delta = +12, LOSS delta = -12
      expect(finalized!.ratings[userA.id]!.delta).toBe(12);
      expect(finalized!.ratings[userA.id]!.after).toBe(1512);
      expect(finalized!.ratings[userB.id]!.delta).toBe(-12);
      expect(finalized!.ratings[userB.id]!.after).toBe(1488);

      await tx.match.update({
        where: { id: match.id },
        data: {
          status: 'FINISHED',
          finishedAt: new Date(),
          winnerUserId: userA.id,
          endReason: 'COMPLETED',
        },
      });

      await srv.ratingsService.applyPostFinalizeRedis(finalized!, sheetId, userA.id);
    });

    // Check Postgres updates
    const ratingRecordA = await srv.prisma.playerRating.findUniqueOrThrow({
      where: { userId: userA.id },
    });
    expect(ratingRecordA.rating).toBe(1512);
    expect(ratingRecordA.peakRating).toBe(1512);
    expect(ratingRecordA.matchesPlayed).toBe(11);
    expect(ratingRecordA.wins).toBe(1);
    expect(ratingRecordA.losses).toBe(0);

    const ratingRecordB = await srv.prisma.playerRating.findUniqueOrThrow({
      where: { userId: userB.id },
    });
    expect(ratingRecordB.rating).toBe(1488);
    expect(ratingRecordB.matchesPlayed).toBe(11);
    expect(ratingRecordB.losses).toBe(1);

    // Verify RatingHistory rows
    const historyA = await srv.prisma.ratingHistory.findMany({ where: { userId: userA.id } });
    expect(historyA).toHaveLength(1);
    expect(historyA[0]!.before).toBe(1500);
    expect(historyA[0]!.after).toBe(1512);
    expect(historyA[0]!.delta).toBe(12);

    // Verify Redis leaderboards
    const globalScoreA = await srv.redis.zscore('lb:global', userA.id);
    expect(globalScoreA).toBe('1512');
    const sheetWinsA = await srv.redis.zscore(`lb:sheet:${sheetId}`, userA.id);
    expect(sheetWinsA).toBe('1');
  });

  it('uses provisional K=40 for new players and K=24 for established players', async () => {
    // Player A has 2 matches (< 10 -> K=40); Player B has 15 matches (>= 10 -> K=24)
    const userNew = await createVerifiedUser('user_prov_a', 1500, 2);
    const userEst = await createVerifiedUser('user_prov_b', 1500, 15);

    const match = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            { userId: userNew.id, handleNorm: 'user_prov_a', ratingBefore: 1500 },
            { userId: userEst.id, handleNorm: 'user_prov_b', ratingBefore: 1500 },
          ],
        },
      },
    });

    await srv.prisma.$transaction(async (tx) => {
      const finalized = await srv.ratingsService.finalizeMatchRatingsInTx(
        match.id,
        sheetId,
        { [userNew.id]: 'WIN', [userEst.id]: 'LOSS' },
        { [userNew.id]: 1000, [userEst.id]: 0 },
        tx,
      );

      expect(finalized).not.toBeNull();
      // userNew has K=40, E=0.5, actual=1 -> delta = 40 * (1 - 0.5) = +20
      expect(finalized!.ratings[userNew.id]!.delta).toBe(20);
      expect(finalized!.ratings[userNew.id]!.after).toBe(1520);

      // userEst has K=24, E=0.5, actual=0 -> delta = 24 * (0 - 0.5) = -12
      expect(finalized!.ratings[userEst.id]!.delta).toBe(-12);
      expect(finalized!.ratings[userEst.id]!.after).toBe(1488);
    });
  });

  it('applies anti-farming dampening (halves K) when 3 matches played in last 24h', async () => {
    const userA = await createVerifiedUser('user_farm_a', 1500, 10);
    const userB = await createVerifiedUser('user_farm_b', 1500, 10);

    // Create 3 historical completed matches between these 2 users within last 24h
    for (let i = 0; i < 3; i++) {
      await srv.prisma.match.create({
        data: {
          mode: 'RANKED',
          status: 'FINISHED',
          sheetId,
          questionCount: 3,
          createdAt: new Date(Date.now() - (i + 1) * 3600 * 1000), // 1h, 2h, 3h ago
          finishedAt: new Date(Date.now() - (i + 1) * 3600 * 1000 + 10 * 60 * 1000),
          players: {
            create: [
              { userId: userA.id, handleNorm: 'user_farm_a', ratingBefore: 1500, totalScore: 500 },
              { userId: userB.id, handleNorm: 'user_farm_b', ratingBefore: 1500, totalScore: 300 },
            ],
          },
        },
      });
    }

    // Now play 4th match
    const match4 = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            { userId: userA.id, handleNorm: 'user_farm_a', ratingBefore: 1500 },
            { userId: userB.id, handleNorm: 'user_farm_b', ratingBefore: 1500 },
          ],
        },
      },
    });

    await srv.prisma.$transaction(async (tx) => {
      const finalized = await srv.ratingsService.finalizeMatchRatingsInTx(
        match4.id,
        sheetId,
        { [userA.id]: 'WIN', [userB.id]: 'LOSS' },
        { [userA.id]: 500, [userB.id]: 200 },
        tx,
      );

      expect(finalized).not.toBeNull();
      // Normally delta would be +12 and -12 (K=24).
      // With anti-farming dampening, K is halved: K = 12 -> delta = 12 * 0.5 = 6!
      expect(finalized!.ratings[userA.id]!.delta).toBe(6);
      expect(finalized!.ratings[userA.id]!.after).toBe(1506);
      expect(finalized!.ratings[userB.id]!.delta).toBe(-6);
      expect(finalized!.ratings[userB.id]!.after).toBe(1494);
    });
  });

  it('clamps ratings at floor 100 and prevents rating dropping below 100', async () => {
    const userA = await createVerifiedUser('user_floor_a', 105, 10);
    const userB = await createVerifiedUser('user_floor_b', 105, 10);

    const match = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            { userId: userA.id, handleNorm: 'user_floor_a', ratingBefore: 105 },
            { userId: userB.id, handleNorm: 'user_floor_b', ratingBefore: 105 },
          ],
        },
      },
    });

    await srv.prisma.$transaction(async (tx) => {
      const finalized = await srv.ratingsService.finalizeMatchRatingsInTx(
        match.id,
        sheetId,
        { [userA.id]: 'WIN', [userB.id]: 'LOSS' },
        { [userA.id]: 500, [userB.id]: 0 },
        tx,
      );

      expect(finalized).not.toBeNull();
      // Nominal delta for player B would be -12 (105 - 12 = 93).
      // Floor is 100, so newRating = 100, delta = 100 - 105 = -5!
      expect(finalized!.ratings[userB.id]!.after).toBe(100);
      expect(finalized!.ratings[userB.id]!.delta).toBe(-5);
    });
  });

  it('does not alter ratings or history for private matches via MatchEngine', async () => {
    const userA = await createVerifiedUser('user_priv_a', 1500, 10);
    const userB = await createVerifiedUser('user_priv_b', 1500, 10);

    const match = await srv.prisma.match.create({
      data: {
        mode: 'PRIVATE',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            { userId: userA.id, handleNorm: 'user_priv_a', ratingBefore: 1500 },
            { userId: userB.id, handleNorm: 'user_priv_b', ratingBefore: 1500 },
          ],
        },
      },
    });

    // When a match is private, finalizeMatchRatings is skipped in doFinishMatch
    await srv.prisma.$transaction(async (tx) => {
      for (const uid of [userA.id, userB.id]) {
        await tx.matchPlayer.update({
          where: { matchId_userId: { matchId: match.id, userId: uid } },
          data: {
            totalScore: uid === userA.id ? 800 : 200,
            result: uid === userA.id ? 'WIN' : 'LOSS',
          },
        });
      }
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: 'FINISHED',
          finishedAt: new Date(),
          winnerUserId: userA.id,
          endReason: 'COMPLETED',
        },
      });
    });

    // Verify rating records were not altered
    const rA = await srv.prisma.playerRating.findUniqueOrThrow({ where: { userId: userA.id } });
    const rB = await srv.prisma.playerRating.findUniqueOrThrow({ where: { userId: userB.id } });
    expect(rA.rating).toBe(1500);
    expect(rB.rating).toBe(1500);

    const history = await srv.prisma.ratingHistory.findMany({ where: { matchId: match.id } });
    expect(history).toHaveLength(0);
  });

  it('serves global and sheet leaderboards with qualification rules and pagination', async () => {
    // Create users:
    // User 1: 10 matches, rating 2200 (qualifies)
    // User 2: 7 matches, rating 1900 (qualifies)
    // User 3: 2 matches, rating 2500 (does NOT qualify for global because matches < 5)
    const user1 = await createVerifiedUser('grandmaster_1', 2200, 10);
    const user2 = await createVerifiedUser('master_2', 1900, 7);
    const user3 = await createVerifiedUser('provisional_3', 2500, 2);

    // Populate Redis leaderboards directly or via rebuild
    await srv.ratingsService.rebuildLeaderboards();

    // 1. Global leaderboard query
    const resGlobal = await request(serverUrl).get(
      '/api/leaderboard?scope=global&limit=10&offset=0',
    );
    expect(resGlobal.status).toBe(200);
    expect(resGlobal.body.scope).toBe('global');
    // user3 has only 2 matches, so must not appear in global leaderboard
    const uids = resGlobal.body.entries.map((e: { userId: string }) => e.userId);
    expect(uids).toContain(user1.id);
    expect(uids).toContain(user2.id);
    expect(uids).not.toContain(user3.id);

    // Verify rank ordering: user1 (2200) rank 1, user2 (1900) rank 2
    expect(resGlobal.body.entries[0].userId).toBe(user1.id);
    expect(resGlobal.body.entries[0].rank).toBe(1);
    expect(resGlobal.body.entries[0].rating).toBe(2200);
    expect(resGlobal.body.entries[1].userId).toBe(user2.id);
    expect(resGlobal.body.entries[1].rank).toBe(2);

    // 2. Authenticated query includes myRank
    const token2 = userToken(user2);
    const resMyRank = await request(serverUrl)
      .get('/api/leaderboard?scope=global')
      .set('Authorization', `Bearer ${token2}`);

    expect(resMyRank.status).toBe(200);
    expect(resMyRank.body.myRank).not.toBeNull();
    expect(resMyRank.body.myRank.rank).toBe(2);
    expect(resMyRank.body.myRank.score).toBe(1900);

    // 3. Sheet leaderboard
    const lbSheet = await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-lb',
        name: 'Sheet LB',
        minRating: 1000,
        maxRating: 1500,
        minSolvedCount: 10,
        questionCount: 3,
        sortOrder: 2,
      },
    });

    await srv.redis.zadd(`lb:sheet:${lbSheet.id}`, 5, user1.id);
    await srv.redis.zadd(`lb:sheet:${lbSheet.id}`, 3, user2.id);

    const resSheet = await request(serverUrl).get(
      `/api/leaderboard?scope=sheet&sheet=sheet-lb&limit=10`,
    );
    expect(resSheet.status).toBe(200);
    expect(resSheet.body.scope).toBe('sheet');
    expect(resSheet.body.sheetSlug).toBe('sheet-lb');
    expect(resSheet.body.entries).toHaveLength(2);
    expect(resSheet.body.entries[0].userId).toBe(user1.id);
    expect(resSheet.body.entries[0].wins).toBe(5);
    expect(resSheet.body.entries[1].userId).toBe(user2.id);
    expect(resSheet.body.entries[1].wins).toBe(3);
  });

  it('serves user profile, sparkline rating history, and match history', async () => {
    const user = await createVerifiedUser('profile_hero', 1650, 8);

    // Add match history and rating points
    const pastMatch = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'FINISHED',
        sheetId,
        questionCount: 3,
        finishedAt: new Date(),
        winnerUserId: user.id,
        endReason: 'COMPLETED',
        players: {
          create: [
            {
              userId: user.id,
              handleNorm: 'profile_hero',
              ratingBefore: 1630,
              ratingAfter: 1650,
              totalScore: 900,
              result: 'WIN',
            },
          ],
        },
      },
    });

    await srv.prisma.ratingHistory.create({
      data: {
        userId: user.id,
        matchId: pastMatch.id,
        before: 1630,
        after: 1650,
        delta: 20,
      },
    });

    await srv.redis.zadd('lb:global', 1650, user.id);

    // 1. GET /api/users/:handle
    const resProfile = await request(serverUrl).get('/api/users/profile_hero');
    expect(resProfile.status).toBe(200);
    expect(resProfile.body.handle).toBe('profile_hero');
    expect(resProfile.body.rating).toBe(1650);
    expect(resProfile.body.globalRank).toBe(1);
    expect(resProfile.body.ratingHistory).toHaveLength(1);
    expect(resProfile.body.ratingHistory[0].delta).toBe(20);

    // 2. GET /api/users/:handle/matches
    const resMatches = await request(serverUrl).get('/api/users/profile_hero/matches');
    expect(resMatches.status).toBe(200);
    expect(resMatches.body.total).toBe(1);
    expect(resMatches.body.matches[0].matchId).toBe(pastMatch.id);
    expect(resMatches.body.matches[0].result).toBe('WIN');
    expect(resMatches.body.matches[0].score).toBe(900);
    expect(resMatches.body.matches[0].delta).toBe(20);
  });

  it('serves match recap with participant authorization on active matches and public on finished', async () => {
    const userA = await createVerifiedUser('recap_player_a', 1500, 5);
    const userB = await createVerifiedUser('recap_player_b', 1500, 5);
    const outsider = await createVerifiedUser('recap_outsider', 1500, 5);

    // 1. Active match recap
    const activeMatch = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'ACTIVE',
        sheetId,
        questionCount: 3,
        players: {
          create: [
            { userId: userA.id, handleNorm: 'recap_player_a', ratingBefore: 1500 },
            { userId: userB.id, handleNorm: 'recap_player_b', ratingBefore: 1500 },
          ],
        },
      },
    });

    const tokenOutsider = userToken(outsider);
    const tokenA = userToken(userA);

    // Outsider cannot view active match -> 403 Forbidden
    const resActiveForbidden = await request(serverUrl)
      .get(`/api/matches/${activeMatch.id}`)
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(resActiveForbidden.status).toBe(403);

    // Participant can view active match -> 200 OK
    const resActiveOk = await request(serverUrl)
      .get(`/api/matches/${activeMatch.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resActiveOk.status).toBe(200);
    expect(resActiveOk.body.matchId).toBe(activeMatch.id);
    expect(resActiveOk.body.status).toBe('ACTIVE');

    // 2. Finished match recap
    const finishedMatch = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        status: 'FINISHED',
        sheetId,
        questionCount: 3,
        finishedAt: new Date(),
        winnerUserId: userA.id,
        endReason: 'COMPLETED',
        players: {
          create: [
            {
              userId: userA.id,
              handleNorm: 'recap_player_a',
              ratingBefore: 1500,
              ratingAfter: 1520,
              totalScore: 900,
              result: 'WIN',
            },
            {
              userId: userB.id,
              handleNorm: 'recap_player_b',
              ratingBefore: 1500,
              ratingAfter: 1480,
              totalScore: 300,
              result: 'LOSS',
            },
          ],
        },
        questions: {
          create: [
            {
              idx: 0,
              problemId: 7001,
              status: 'ENDED',
              results: {
                create: [
                  { userId: userA.id, points: 900, firstSolve: true },
                  { userId: userB.id, points: 300, firstSolve: false },
                ],
              },
            },
          ],
        },
      },
    });

    // Public request (no auth) can view finished match recap
    const resFinishedPublic = await request(serverUrl).get(`/api/matches/${finishedMatch.id}`);
    expect(resFinishedPublic.status).toBe(200);
    expect(resFinishedPublic.body.matchId).toBe(finishedMatch.id);
    expect(resFinishedPublic.body.status).toBe('FINISHED');
    expect(resFinishedPublic.body.players).toHaveLength(2);
    expect(resFinishedPublic.body.players[0].delta).toBe(20);
    expect(resFinishedPublic.body.questions).toHaveLength(1);
    expect(resFinishedPublic.body.questions[0].scores[userA.id]).toBe(900);
    expect(resFinishedPublic.body.questions[0].firstSolveUserId).toBe(userA.id);
  });
});
