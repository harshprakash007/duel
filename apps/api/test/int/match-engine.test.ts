import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { BotClient } from '../helpers/bot-client';
import { signAuthToken } from '../../src/modules/auth/jwt';
import type { PollerVerdictEvent } from '../../src/modules/poller/poller.types';

import { createPrisma } from '../../src/db/prisma';

describe('MatchEngine & Realtime Integration', () => {
  let srv: RunningServer;
  let serverUrl: string;

  // Use shortened timers for fast test runs
  const config = loadConfig(
    testEnv({
      MATCH_COUNTDOWN_MS: '300',
      MATCH_BREAK_MS: '300',
      MATCH_POST_FIRST_SOLVE_MS: '2000',
    }),
  );

  beforeAll(async () => {
    const initPrisma = createPrisma(config.databaseUrl);
    await cleanDb(initPrisma);
    await initPrisma.$disconnect();

    srv = await startServer(config);
    serverUrl = `http://localhost:${srv.port}`;
    await srv.redis.flushdb();
  });

  afterAll(async () => {
    if (srv) {
      await srv.close();
    }
  });

  it('runs a complete bot-vs-bot match with state transitions and scoring', async () => {
    // 1. Seed two players with verified handles and ratings
    const userA = await srv.prisma.user.create({
      data: {
        email: 'playera@example.com',
        displayName: 'PlayerA',
        passwordHash: 'dummy',
        role: 'USER',
        handle: {
          create: {
            handle: 'tourist',
            handleNorm: 'tourist',
            cfRatingAtLink: 3000,
            verifiedAt: new Date(),
          },
        },
        rating: {
          create: {
            rating: 1500,
            peakRating: 1500,
            matchesPlayed: 0,
          },
        },
      },
    });

    const userB = await srv.prisma.user.create({
      data: {
        email: 'playerb@example.com',
        displayName: 'PlayerB',
        passwordHash: 'dummy',
        role: 'USER',
        handle: {
          create: {
            handle: 'petr',
            handleNorm: 'petr',
            cfRatingAtLink: 2800,
            verifiedAt: new Date(),
          },
        },
        rating: {
          create: {
            rating: 1500,
            peakRating: 1500,
            matchesPlayed: 0,
          },
        },
      },
    });

    // 2. Seed LevelSheet and 2 problems
    const sheet = await srv.prisma.levelSheet.create({
      data: {
        slug: 'test-sheet-m5',
        name: 'M5 Sheet',
        minRating: 800,
        maxRating: 1000,
        minSolvedCount: 50,
        questionCount: 2,
        sortOrder: 1,
      },
    });

    await srv.prisma.problem.createMany({
      data: [
        {
          id: 5001,
          contestId: 500,
          index: 'A',
          name: 'P1',
          rating: 800,
          tags: ['math'],
          solvedCount: 1000,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 5002,
          contestId: 500,
          index: 'B',
          name: 'P2',
          rating: 900,
          tags: ['implementation'],
          solvedCount: 800,
          isActive: true,
          syncedAt: new Date(),
        },
      ],
    });

    // 3. Create tokens for both users
    const tokenA = signAuthToken(
      { sub: userA.id, email: userA.email, role: userA.role },
      config.auth.jwtSecret,
      3600,
    );
    const tokenB = signAuthToken(
      { sub: userB.id, email: userB.email, role: userB.role },
      config.auth.jwtSecret,
      3600,
    );

    // 4. Create Match
    const match = await srv.matchEngine.createMatch({
      sheetId: sheet.id,
      mode: 'RANKED',
      players: [
        { userId: userA.id, handle: 'tourist', handleNorm: 'tourist', rating: 1500 },
        { userId: userB.id, handle: 'petr', handleNorm: 'petr', rating: 1500 },
      ],
      questionCount: 2,
    });

    expect(match.matchId).toBeDefined();
    expect(match.status).toBe('COUNTDOWN');

    // 5. Connect bot clients
    const botA = new BotClient({ url: serverUrl, token: tokenA });
    const botB = new BotClient({ url: serverUrl, token: tokenB });

    await botA.connect();
    await botB.connect();

    // Both bots should see the match in COUNTDOWN state
    const stateA = await botA.waitForState((s) => s.matchId === match.matchId);
    expect(stateA.status).toBe('COUNTDOWN');
    expect(stateA.currentProblem).toBeUndefined(); // Problems hidden during COUNTDOWN

    // 6. Wait for Q0 to start (COUNTDOWN timer is 300ms)
    const activeQ0State = await botA.waitForState(
      (s) => s.status === 'ACTIVE' && s.currentQuestionIdx === 0,
      3000,
    );
    expect(activeQ0State.currentProblem).toBeDefined();
    expect(activeQ0State.currentProblem?.contestId).toBe(500);

    const q0 = match.questions[0]!;
    const q0StartMs = q0.startedAtMs!;

    // 7. Simulate Player A submitting WRONG_ANSWER
    const wrongVerdict: PollerVerdictEvent = {
      matchId: match.matchId,
      questionIdx: 0,
      userId: userA.id,
      handleNorm: 'tourist',
      submissionId: 1000100n,
      contestId: q0.problem.contestId,
      index: q0.problem.index,
      verdict: 'WRONG_ANSWER',
      passedTestCount: 3,
      timeConsumedMillis: 30,
      memoryConsumedBytes: 1024,
      creationTimeSeconds: Math.floor((q0StartMs + 5000) / 1000),
      detectedAtMs: Date.now(),
    };

    await srv.matchEngine.handleVerdict(wrongVerdict);

    // Verify wrong attempts updated
    const stateAfterWrong = await botA.waitForState(
      (s) => s.players[userA.id]?.wrongAttemptsCurrent === 1,
      2000,
    );
    expect(stateAfterWrong.players[userA.id]?.solvedCurrent).toBe(false);

    // 8. Player A submits OK (First Solve)
    const originalDeadline = q0.deadlineAtMs!;
    const okVerdictA: PollerVerdictEvent = {
      matchId: match.matchId,
      questionIdx: 0,
      userId: userA.id,
      handleNorm: 'tourist',
      submissionId: 1000101n,
      contestId: q0.problem.contestId,
      index: q0.problem.index,
      verdict: 'OK',
      passedTestCount: 15,
      timeConsumedMillis: 45,
      memoryConsumedBytes: 2048,
      creationTimeSeconds: Math.floor((q0StartMs + 10000) / 1000),
      detectedAtMs: Date.now(),
    };

    await srv.matchEngine.handleVerdict(okVerdictA);

    // Verify Post-First-Solve rule: deadline shrinks
    const stateAfterAOk = await botA.waitForState(
      (s) => s.players[userA.id]?.solvedCurrent === true,
      2000,
    );
    expect(stateAfterAOk.players[userA.id]?.solvedCurrent).toBe(true);
    expect(stateAfterAOk.questionDeadlineMs).toBeLessThan(originalDeadline);

    // 9. Player B also submits OK
    const okVerdictB: PollerVerdictEvent = {
      matchId: match.matchId,
      questionIdx: 0,
      userId: userB.id,
      handleNorm: 'petr',
      submissionId: 1000102n,
      contestId: q0.problem.contestId,
      index: q0.problem.index,
      verdict: 'OK',
      passedTestCount: 15,
      timeConsumedMillis: 60,
      memoryConsumedBytes: 2048,
      creationTimeSeconds: Math.floor((q0StartMs + 12000) / 1000),
      detectedAtMs: Date.now(),
    };

    await srv.matchEngine.handleVerdict(okVerdictB);

    // Both solved -> Q0 ends immediately and enters break
    const stateQ0Ended = await botA.waitForState((s) => s.questionResults.length === 1, 3000);
    expect(stateQ0Ended.questionResults[0]!.firstSolveUserId).toBe(userA.id);
    expect(stateQ0Ended.players[userA.id]!.score).toBeGreaterThan(0);
    expect(stateQ0Ended.players[userB.id]!.score).toBeGreaterThan(0);

    // Player A should have more points due to first solve bonus
    expect(stateQ0Ended.players[userA.id]!.score).toBeGreaterThan(
      stateQ0Ended.players[userB.id]!.score,
    );

    // 10. Break finishes (300ms) -> Q1 starts
    const activeQ1State = await botA.waitForState(
      (s) => s.status === 'ACTIVE' && s.currentQuestionIdx === 1,
      3000,
    );
    expect(activeQ1State.currentQuestionIdx).toBe(1);

    // 11. Conclude Q1 via endQuestion
    await srv.matchEngine.endQuestion(match.matchId, 1);

    // 12. Match finishes
    const finalState = await botA.waitForState((s) => s.status === 'FINISHED', 3000);
    expect(finalState.winnerUserId).toBe(userA.id);
    expect(finalState.endReason).toBe('COMPLETED');

    // 13. Verify DB persistence
    const dbMatch = await srv.prisma.match.findUnique({
      where: { id: match.matchId },
      include: { players: true, questions: true },
    });
    expect(dbMatch?.status).toBe('FINISHED');
    expect(dbMatch?.winnerUserId).toBe(userA.id);
    expect(dbMatch?.endReason).toBe('COMPLETED');

    const dbPlayerA = dbMatch?.players.find((p) => p.userId === userA.id);
    const dbPlayerB = dbMatch?.players.find((p) => p.userId === userB.id);
    expect(dbPlayerA?.result).toBe('WIN');
    expect(dbPlayerB?.result).toBe('LOSS');

    // Clean up bots
    botA.disconnect();
    botB.disconnect();
  });

  it('handles player resignation mid-match', async () => {
    const userC = await srv.prisma.user.create({
      data: {
        email: 'playerc@example.com',
        displayName: 'PlayerC',
        passwordHash: 'dummy',
        role: 'USER',
        rating: { create: { rating: 1400, peakRating: 1400, matchesPlayed: 0 } },
      },
    });

    const userD = await srv.prisma.user.create({
      data: {
        email: 'playerd@example.com',
        displayName: 'PlayerD',
        passwordHash: 'dummy',
        role: 'USER',
        rating: { create: { rating: 1400, peakRating: 1400, matchesPlayed: 0 } },
      },
    });

    const sheet = await srv.prisma.levelSheet.findFirstOrThrow();

    const match = await srv.matchEngine.createMatch({
      sheetId: sheet.id,
      mode: 'RANKED',
      players: [
        { userId: userC.id, handle: 'c_handle', handleNorm: 'c_handle', rating: 1400 },
        { userId: userD.id, handle: 'd_handle', handleNorm: 'd_handle', rating: 1400 },
      ],
      questionCount: 1,
    });

    const tokenC = signAuthToken(
      { sub: userC.id, email: userC.email, role: userC.role },
      config.auth.jwtSecret,
      3600,
    );
    const tokenD = signAuthToken(
      { sub: userD.id, email: userD.email, role: userD.role },
      config.auth.jwtSecret,
      3600,
    );

    const botC = new BotClient({ url: serverUrl, token: tokenC });
    const botD = new BotClient({ url: serverUrl, token: tokenD });

    await botC.connect();
    await botD.connect();

    // Wait until ACTIVE
    await botC.waitForState((s) => s.status === 'ACTIVE', 3000);

    // Bot C resigns
    const resignRes = await botC.resign();
    expect(resignRes.ok).toBe(true);

    const finishedState = await botD.waitForState((s) => s.status === 'FINISHED', 3000);
    expect(finishedState.winnerUserId).toBe(userD.id);
    expect(finishedState.endReason).toBe('RESIGN');

    const dbMatch = await srv.prisma.match.findUnique({
      where: { id: match.matchId },
      include: { players: true },
    });
    expect(dbMatch?.status).toBe('FINISHED');
    expect(dbMatch?.winnerUserId).toBe(userD.id);
    expect(dbMatch?.endReason).toBe('RESIGN');

    const pC = dbMatch?.players.find((p) => p.userId === userC.id);
    const pD = dbMatch?.players.find((p) => p.userId === userD.id);
    expect(pC?.result).toBe('LOSS');
    expect(pD?.result).toBe('WIN');

    botC.disconnect();
    botD.disconnect();
  });

  it('pauses deadlines during CF DEGRADED and extends on recovery', async () => {
    const userE = await srv.prisma.user.create({
      data: {
        email: 'playere@example.com',
        displayName: 'PlayerE',
        passwordHash: 'dummy',
        role: 'USER',
        rating: { create: { rating: 1300, peakRating: 1300, matchesPlayed: 0 } },
      },
    });

    const userF = await srv.prisma.user.create({
      data: {
        email: 'playerf@example.com',
        displayName: 'PlayerF',
        passwordHash: 'dummy',
        role: 'USER',
        rating: { create: { rating: 1300, peakRating: 1300, matchesPlayed: 0 } },
      },
    });

    const sheet = await srv.prisma.levelSheet.findFirstOrThrow();

    await srv.matchEngine.createMatch({
      sheetId: sheet.id,
      mode: 'RANKED',
      players: [
        { userId: userE.id, handle: 'e_handle', handleNorm: 'e_handle', rating: 1300 },
        { userId: userF.id, handle: 'f_handle', handleNorm: 'f_handle', rating: 1300 },
      ],
      questionCount: 1,
    });

    const tokenE = signAuthToken(
      { sub: userE.id, email: userE.email, role: userE.role },
      config.auth.jwtSecret,
      3600,
    );

    const botE = new BotClient({ url: serverUrl, token: tokenE });
    await botE.connect();

    // Wait until ACTIVE
    const activeState = await botE.waitForState((s) => s.status === 'ACTIVE', 3000);
    const originalDeadline = activeState.questionDeadlineMs!;

    // Trigger Codeforces outage
    srv.matchEngine.handleCfStateChange(true);

    const degradedState = await botE.waitForState((s) => s.paused === true, 3000);
    expect(degradedState.paused).toBe(true);

    // Simulate 100ms outage duration
    await new Promise((r) => setTimeout(r, 100));

    // Recover Codeforces
    srv.matchEngine.handleCfStateChange(false);

    const recoveredState = await botE.waitForState((s) => s.paused === false, 3000);
    expect(recoveredState.paused).toBe(false);
    expect(recoveredState.questionDeadlineMs!).toBeGreaterThan(originalDeadline);

    botE.disconnect();
  });

  it('recovers active matches on boot from Postgres and re-arms timers', async () => {
    // 1. Create a match directly in DB in ACTIVE state with future deadline
    const userG = await srv.prisma.user.create({
      data: {
        email: 'playerg@example.com',
        displayName: 'PlayerG',
        passwordHash: 'dummy',
        role: 'USER',
        handle: {
          create: {
            handle: 'g_handle',
            handleNorm: 'g_handle',
            cfRatingAtLink: 1200,
            verifiedAt: new Date(),
          },
        },
        rating: { create: { rating: 1200, peakRating: 1200, matchesPlayed: 0 } },
      },
    });

    const userH = await srv.prisma.user.create({
      data: {
        email: 'playerh@example.com',
        displayName: 'PlayerH',
        passwordHash: 'dummy',
        role: 'USER',
        handle: {
          create: {
            handle: 'h_handle',
            handleNorm: 'h_handle',
            cfRatingAtLink: 1200,
            verifiedAt: new Date(),
          },
        },
        rating: { create: { rating: 1200, peakRating: 1200, matchesPlayed: 0 } },
      },
    });

    const sheet = await srv.prisma.levelSheet.findFirstOrThrow();
    const problem = await srv.prisma.problem.findFirstOrThrow();

    const futureDeadline = new Date(Date.now() + 5000); // 5 seconds in future

    const recoveredDbMatch = await srv.prisma.match.create({
      data: {
        sheetId: sheet.id,
        mode: 'RANKED',
        status: 'ACTIVE',
        questionCount: 1,
        startedAt: new Date(),
        players: {
          create: [
            { userId: userG.id, handleNorm: 'g_handle', ratingBefore: 1200 },
            { userId: userH.id, handleNorm: 'h_handle', ratingBefore: 1200 },
          ],
        },
        questions: {
          create: [
            {
              idx: 0,
              problemId: problem.id,
              status: 'ACTIVE',
              startedAt: new Date(),
              deadlineAt: futureDeadline,
            },
          ],
        },
      },
    });

    // 2. Invoke recoverActiveMatches
    await srv.matchEngine.recoverActiveMatches();

    // 3. Verify match is active in memory and players are in Redis
    const inMemMatch = srv.matchEngine.getActiveMatch(recoveredDbMatch.id);
    expect(inMemMatch).toBeDefined();
    expect(inMemMatch?.status).toBe('ACTIVE');

    const activeForG = await srv.matchEngine.getActiveMatchForUser(userG.id);
    expect(activeForG?.matchId).toBe(recoveredDbMatch.id);

    // Verify registered in PollerService
    expect(srv.pollerService.getActive('g_handle')).toBeDefined();
    expect(srv.pollerService.getActive('h_handle')).toBeDefined();
  });
});
