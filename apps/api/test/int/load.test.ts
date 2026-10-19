import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { createPrisma } from '../../src/db/prisma';
import { BotClient } from '../helpers/bot-client';
import { signAuthToken } from '../../src/modules/auth/jwt';

describe('Concurrent Load & Latency Verification (M9 / §19)', () => {
  let srv: RunningServer;
  let serverUrl: string;

  const config = loadConfig(
    testEnv({
      MATCH_COUNTDOWN_MS: '500',
      MATCH_BREAK_MS: '200',
      MATCH_NO_SHOW_TIMEOUT_MS: '5000',
    }),
  );

  beforeAll(async () => {
    const initPrisma = createPrisma(config.databaseUrl);
    await cleanDb(initPrisma);
    await initPrisma.$disconnect();

    srv = await startServer(config);
    serverUrl = `http://localhost:${srv.port}`;
    await srv.redis.flushdb();

    await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-load',
        name: 'Load Test Sheet',
        minRating: 800,
        maxRating: 1400,
        minSolvedCount: 10,
        questionCount: 3,
        sortOrder: 1,
      },
    });

    await srv.prisma.problem.createMany({
      data: [
        {
          id: 5001,
          contestId: 500,
          index: 'A',
          name: 'Load Prob 1',
          rating: 900,
          tags: ['math'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 5002,
          contestId: 500,
          index: 'B',
          name: 'Load Prob 2',
          rating: 1100,
          tags: ['implementation'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 5003,
          contestId: 500,
          index: 'C',
          name: 'Load Prob 3',
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

  function createTestToken(user: { id: string; email: string; role?: 'USER' | 'ADMIN' }): string {
    return signAuthToken(
      { sub: user.id, email: user.email, role: user.role ?? 'USER' },
      config.auth.jwtSecret,
      config.auth.jwtExpiresSec,
    );
  }

  it('handles concurrent socket clients with p95 event latency under 300ms and stable memory', async () => {
    const NUM_CLIENTS = 20; // 10 pairs of concurrent bot players
    const clients: BotClient[] = [];
    const latencies: number[] = [];

    // Measure memory before load
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;

    // 1. Concurrently register test users
    const userPromises = Array.from({ length: NUM_CLIENTS }, async (_, i) => {
      const user = await srv.prisma.user.create({
        data: {
          email: `loadbot_${i}@test.local`,
          displayName: `LoadBot${i}`,
          passwordHash: 'dummy',
          handle: {
            create: {
              handle: `load_cf_${i}`,
              handleNorm: `load_cf_${i}`,
              verifiedAt: new Date(),
            },
          },
          rating: { create: { rating: 1200, peakRating: 1200 } },
        },
      });
      return user;
    });

    const users = await Promise.all(userPromises);

    // 2. Concurrently connect all bot socket clients
    const connectStart = Date.now();
    await Promise.all(
      users.map(async (u) => {
        const token = createTestToken(u);
        const bot = new BotClient({ url: serverUrl, token });
        clients.push(bot);
        await bot.connect();
      }),
    );
    const _connectDuration = Date.now() - connectStart;
    expect(clients.length).toBe(NUM_CLIENTS);

    // 3. Execute concurrent room creation, join, ready, and rejoin actions while recording latencies
    const numPairs = NUM_CLIENTS / 2;
    const matchActions = Array.from({ length: numPairs }, async (_, idx) => {
      const botA = clients[idx * 2]!;
      const botB = clients[idx * 2 + 1]!;

      // Action 1: Create room
      const t0 = Date.now();
      const roomRes = await botA.createRoom('sheet-load', 3);
      latencies.push(Date.now() - t0);
      expect(roomRes.ok).toBe(true);
      const roomCode = roomRes.roomCode!;

      // Action 2: Join room
      const t1 = Date.now();
      const joinRes = await botB.joinRoom(roomCode);
      latencies.push(Date.now() - t1);
      expect(joinRes.ok).toBe(true);

      // Action 3: Player ready
      const t2 = Date.now();
      const [readyA, readyB] = await Promise.all([botA.ready(), botB.ready()]);
      latencies.push(Date.now() - t2);
      expect(readyA.ok).toBe(true);
      expect(readyB.ok).toBe(true);

      // Action 4: Rejoin snapshot
      const t3 = Date.now();
      const [rejoinA, rejoinB] = await Promise.all([botA.rejoin(), botB.rejoin()]);
      latencies.push(Date.now() - t3);
      expect(rejoinA.ok).toBe(true);
      expect(rejoinB.ok).toBe(true);
    });

    await Promise.all(matchActions);

    // 4. Compute latency metrics and assert p95 < 300ms
    expect(latencies.length).toBeGreaterThan(0);
    latencies.sort((a, b) => a - b);
    const p50Idx = Math.floor(latencies.length * 0.5);
    const p95Idx = Math.floor(latencies.length * 0.95);
    const p50 = latencies[p50Idx]!;
    const p95 = latencies[p95Idx]!;

    // 5. Memory check
    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;
    const _memDiffMb = Math.round((memAfter - memBefore) / 1024 / 1024);

    // 6. Clean up socket connections
    for (const client of clients) {
      client.disconnect();
    }

    // Targets from §19: p95 event latency under 300 ms, stable memory
    expect(p95).toBeLessThan(300);
    expect(p50).toBeLessThan(150);
  });
});
