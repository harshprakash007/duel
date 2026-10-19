import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { createPrisma } from '../../src/db/prisma';
import { BotClient } from '../helpers/bot-client';
import { signAuthToken } from '../../src/modules/auth/jwt';

describe('Chaos & Fault Tolerance Testing (M9 / §19)', () => {
  let srv: RunningServer;
  let serverUrl: string;
  let sheetId: string;

  const config = loadConfig(
    testEnv({
      MATCH_COUNTDOWN_MS: '1000',
      MATCH_BREAK_MS: '500',
      MATCH_NO_SHOW_TIMEOUT_MS: '2000',
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

    const sheet = await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-chaos',
        name: 'Chaos Sheet',
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
          id: 8001,
          contestId: 800,
          index: 'A',
          name: 'Chaos Prob 1',
          rating: 900,
          tags: ['math'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 8002,
          contestId: 800,
          index: 'B',
          name: 'Chaos Prob 2',
          rating: 1100,
          tags: ['implementation'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 8003,
          contestId: 800,
          index: 'C',
          name: 'Chaos Prob 3',
          rating: 1300,
          tags: ['greedy'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    if (srv) {
      await srv.close();
    }
  });

  beforeEach(async () => {
    await srv.redis.flushdb();
  });

  function createTestToken(user: { id: string; email: string; role?: 'USER' | 'ADMIN' }): string {
    return signAuthToken(
      { sub: user.id, email: user.email, role: user.role ?? 'USER' },
      config.auth.jwtSecret,
      config.auth.jwtExpiresSec,
    );
  }

  it('recovers active match state and re-arms countdown timers after mid-match server restart', async () => {
    // 1. Create two test players
    const userA = await srv.prisma.user.create({
      data: {
        email: 'chaos-a@test.com',
        displayName: 'ChaosA',
        passwordHash: 'dummy',
        handle: { create: { handle: 'chaos_a', handleNorm: 'chaos_a', verifiedAt: new Date() } },
        rating: { create: { rating: 1200, peakRating: 1200 } },
      },
    });

    const userB = await srv.prisma.user.create({
      data: {
        email: 'chaos-b@test.com',
        displayName: 'ChaosB',
        passwordHash: 'dummy',
        handle: { create: { handle: 'chaos_b', handleNorm: 'chaos_b', verifiedAt: new Date() } },
        rating: { create: { rating: 1200, peakRating: 1200 } },
      },
    });

    // 2. Start ranked match
    const match = await srv.matchEngine.createMatch({
      sheetId,
      mode: 'RANKED',
      players: [
        { userId: userA.id, handle: 'chaos_a', handleNorm: 'chaos_a', rating: 1200 },
        { userId: userB.id, handle: 'chaos_b', handleNorm: 'chaos_b', rating: 1200 },
      ],
    });

    // Advance match into ACTIVE state
    await srv.matchEngine.playerReady(match.matchId, userA.id);
    await srv.matchEngine.playerReady(match.matchId, userB.id);

    // Question 0 starts with active deadline
    await srv.matchEngine.startQuestion(match.matchId, 0);

    const activeBeforeKill = srv.matchEngine.getActiveMatch(match.matchId);
    expect(activeBeforeKill).toBeDefined();
    expect(activeBeforeKill!.status).toBe('ACTIVE');
    expect(activeBeforeKill!.currentQuestionIdx).toBe(0);
    const initialDeadlineMs = activeBeforeKill!.questions[0]!.deadlineAtMs!;
    expect(initialDeadlineMs).toBeGreaterThan(Date.now());

    // 3. Simulate sudden crash: shutdown server 1 without deleting DB / Redis state
    await srv.close();

    // 4. Start Server 2 pointing to the same DB & Redis
    srv = await startServer(config);
    serverUrl = `http://localhost:${srv.port}`;

    // 5. Verify match was restored during boot recovery
    const recoveredMatch = srv.matchEngine.getActiveMatch(match.matchId);
    expect(recoveredMatch).toBeDefined();
    expect(recoveredMatch!.matchId).toBe(match.matchId);
    expect(recoveredMatch!.status).toBe('ACTIVE');
    expect(recoveredMatch!.currentQuestionIdx).toBe(0);
    expect(recoveredMatch!.questions[0]!.deadlineAtMs).toBe(initialDeadlineMs);

    // 6. Connect bot client to server 2 and verify rejoin snapshot
    const tokenA = createTestToken(userA);
    const bot = new BotClient({
      url: serverUrl,
      token: tokenA,
    });

    await bot.connect();
    const rejoinRes = await bot.rejoin();
    expect(rejoinRes.ok).toBe(true);
    expect(rejoinRes.snapshot).toBeDefined();
    expect(rejoinRes.snapshot!.matchId).toBe(match.matchId);
    expect(rejoinRes.snapshot!.status).toBe('ACTIVE');
    expect(rejoinRes.snapshot!.currentQuestionIdx).toBe(0);

    bot.disconnect();
  });

  it('pauses question countdown during Codeforces degraded outage and resumes with extended deadline', async () => {
    // 1. Create two test players
    const userA = await srv.prisma.user.create({
      data: {
        email: 'outage-a@test.com',
        displayName: 'OutageA',
        passwordHash: 'dummy',
        handle: { create: { handle: 'outage_a', handleNorm: 'outage_a', verifiedAt: new Date() } },
        rating: { create: { rating: 1200, peakRating: 1200 } },
      },
    });

    const userB = await srv.prisma.user.create({
      data: {
        email: 'outage-b@test.com',
        displayName: 'OutageB',
        passwordHash: 'dummy',
        handle: { create: { handle: 'outage_b', handleNorm: 'outage_b', verifiedAt: new Date() } },
        rating: { create: { rating: 1200, peakRating: 1200 } },
      },
    });

    const match = await srv.matchEngine.createMatch({
      sheetId,
      mode: 'RANKED',
      players: [
        { userId: userA.id, handle: 'outage_a', handleNorm: 'outage_a', rating: 1200 },
        { userId: userB.id, handle: 'outage_b', handleNorm: 'outage_b', rating: 1200 },
      ],
    });

    await srv.matchEngine.startQuestion(match.matchId, 0);

    const activeMatch = srv.matchEngine.getActiveMatch(match.matchId)!;
    const originalDeadlineMs = activeMatch.questions[0]!.deadlineAtMs!;

    // 2. Connect bot to capture system broadcasts
    const tokenA = createTestToken(userA);
    const bot = new BotClient({
      url: serverUrl,
      token: tokenA,
    });
    await bot.connect();
    await bot.rejoin();

    const degradedEvents: Array<{ reason?: string }> = [];
    const recoveredEvents: Array<{ pausedDurationMs: number }> = [];

    bot.socket.on('system:cf_degraded', (ev: unknown) => {
      degradedEvents.push(ev as { reason?: string });
    });
    bot.socket.on('system:cf_recovered', (ev: unknown) => {
      recoveredEvents.push(ev as { pausedDurationMs: number });
    });

    // 3. Simulate Codeforces outage
    srv.cfClient.emit('stateChange', 'DEGRADED');

    // Give event loop time to process stateChange
    await new Promise((r) => setTimeout(r, 50));

    expect(activeMatch.paused).toBe(true);
    expect(activeMatch.pausedAtMs).toBeDefined();

    // 4. Stay paused for 200ms
    await new Promise((r) => setTimeout(r, 200));

    // 5. Codeforces recovers
    srv.cfClient.emit('stateChange', 'OK');

    await new Promise((r) => setTimeout(r, 50));

    expect(activeMatch.paused).toBe(false);
    expect(activeMatch.pausedTotalMs).toBeGreaterThanOrEqual(180);
    // Deadline extended by at least the paused duration
    expect(activeMatch.questions[0]!.deadlineAtMs).toBeGreaterThan(originalDeadlineMs);

    bot.disconnect();
  });
});
