import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { BotClient } from '../helpers/bot-client';
import { signAuthToken } from '../../src/modules/auth/jwt';
import type { Role } from '../../src/generated/prisma/client';
import { createPrisma } from '../../src/db/prisma';

describe('Matchmaking & Queues Integration (M6)', () => {
  let srv: RunningServer;
  let serverUrl: string;

  const config = loadConfig(
    testEnv({
      MATCH_COUNTDOWN_MS: '1000',
      MATCH_BREAK_MS: '500',
      MATCH_NO_SHOW_TIMEOUT_MS: '1000',
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
    await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-m6',
        name: 'M6 Sheet',
        minRating: 800,
        maxRating: 1200,
        minSolvedCount: 10,
        questionCount: 3,
        sortOrder: 1,
      },
    });

    await srv.prisma.problem.createMany({
      data: [
        {
          id: 6001,
          contestId: 600,
          index: 'A',
          name: 'Prob 6A',
          rating: 800,
          tags: ['implementation'],
          solvedCount: 500,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6002,
          contestId: 600,
          index: 'B',
          name: 'Prob 6B',
          rating: 850,
          tags: ['math'],
          solvedCount: 450,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6003,
          contestId: 600,
          index: 'C',
          name: 'Prob 6C',
          rating: 900,
          tags: ['greedy'],
          solvedCount: 400,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6004,
          contestId: 600,
          index: 'D',
          name: 'Prob 6D',
          rating: 950,
          tags: ['dp'],
          solvedCount: 350,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6005,
          contestId: 600,
          index: 'E',
          name: 'Prob 6E',
          rating: 1000,
          tags: ['graphs'],
          solvedCount: 300,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6006,
          contestId: 600,
          index: 'F',
          name: 'Prob 6F',
          rating: 1050,
          tags: ['strings'],
          solvedCount: 250,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6007,
          contestId: 600,
          index: 'G',
          name: 'Prob 6G',
          rating: 1100,
          tags: ['trees'],
          solvedCount: 200,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6008,
          contestId: 600,
          index: 'H',
          name: 'Prob 6H',
          rating: 1150,
          tags: ['math'],
          solvedCount: 150,
          isActive: true,
          syncedAt: new Date(),
        },
        {
          id: 6009,
          contestId: 600,
          index: 'I',
          name: 'Prob 6I',
          rating: 1200,
          tags: ['geometry'],
          solvedCount: 100,
          isActive: true,
          syncedAt: new Date(),
        },
      ],
    });
  });

  beforeEach(async () => {
    const keys = await srv.redis.keys('mm:*');
    const activeKeys = await srv.redis.keys('active:*');
    const all = [...keys, ...activeKeys];
    if (all.length > 0) {
      await srv.redis.del(...all);
    }
  });

  afterAll(async () => {
    if (srv) {
      await srv.close();
    }
  });

  async function createVerifiedUser(handle: string, rating: number) {
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
            matchesPlayed: 0,
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

  it('enqueues players and pairs them via leader matchmaking tick loop', async () => {
    const userA = await createVerifiedUser('tourist_m6', 1500);
    const userB = await createVerifiedUser('petr_m6', 1520);

    const tokenA = userToken(userA);
    const tokenB = userToken(userB);

    const botA = new BotClient({ url: serverUrl, token: tokenA });
    const botB = new BotClient({ url: serverUrl, token: tokenB });

    await botA.connect();
    await botB.connect();

    // 1. Bot A joins queue
    const resA = await botA.joinQueue('sheet-m6');
    expect(resA.ok).toBe(true);

    const activeA = await srv.redis.get(`active:${userA.id}`);
    expect(activeA).toMatch(/^queue:/);

    // 2. Bot B joins queue
    const resB = await botB.joinQueue('sheet-m6');
    expect(resB.ok).toBe(true);

    // 3. Test queue status broadcast
    const statusPromise = botA.waitForEvent<{ waitedMs: number; window: number }>('queue:status');
    await srv.matchmakingService.broadcastQueueStatus();
    const status = await statusPromise;
    expect(status.waitedMs).toBeGreaterThanOrEqual(0);
    expect(status.window).toBe(100);

    // 4. Listen for match:found
    const foundPromiseA = botA.waitForEvent<{ matchId: string; opponent: { userId: string } }>(
      'match:found',
    );
    const foundPromiseB = botB.waitForEvent<{ matchId: string; opponent: { userId: string } }>(
      'match:found',
    );

    // 5. Execute tick
    await srv.matchmakingService.tick();

    const [foundA, foundB] = await Promise.all([foundPromiseA, foundPromiseB]);
    expect(foundA.matchId).toBeDefined();
    expect(foundA.matchId).toBe(foundB.matchId);
    expect(foundA.opponent.userId).toBe(userB.id);
    expect(foundB.opponent.userId).toBe(userA.id);

    // 6. Verify Redis active pointers updated to match
    const finalActiveA = await srv.redis.get(`active:${userA.id}`);
    expect(finalActiveA).toBe(`match:${foundA.matchId}`);

    // 7. Verify match is in COUNTDOWN status
    const stateA = await botA.waitForState((s) => s.status === 'COUNTDOWN');
    expect(stateA.status).toBe('COUNTDOWN');
    expect(stateA.mode).toBe('RANKED');

    // 8. Test REST active-match endpoint
    const restRes = await request(srv.server)
      .get('/api/me/active-match')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(restRes.status).toBe(200);
    expect(restRes.body.match).toBeDefined();
    expect(restRes.body.match.matchId).toBe(foundA.matchId);

    botA.disconnect();
    botB.disconnect();
  });

  it('respects expanding rating window and pairs only when wait time widens window', async () => {
    // Delta = 350 (1200 vs 1550) -> base window is 100, requires waitSec >= 25s for window >= 350
    const userC = await createVerifiedUser('expand_c', 1200);
    const userD = await createVerifiedUser('expand_d', 1550);

    const tokenC = userToken(userC);
    const tokenD = userToken(userD);

    const botC = new BotClient({ url: serverUrl, token: tokenC });
    const botD = new BotClient({ url: serverUrl, token: tokenD });

    await botC.connect();
    await botD.connect();

    await botC.joinQueue('sheet-m6');
    await botD.joinQueue('sheet-m6');

    // Tick immediately -> should NOT pair because delta (350) > window (100)
    await srv.matchmakingService.tick();

    const activeC = await srv.redis.get(`active:${userC.id}`);
    expect(activeC).toMatch(/^queue:/);

    // Artificially age both tickets to 30s ago -> both windows become min(100 + 50*6, 600) = 400
    const now = Date.now();
    const agedTime = now - 30_000;
    for (const u of [userC, userD]) {
      const ticketRaw = await srv.redis.get(`mm:ticket:${u.id}`);
      const ticket = JSON.parse(ticketRaw!);
      ticket.enqueuedAtMs = agedTime;
      await srv.redis.set(`mm:ticket:${u.id}`, JSON.stringify(ticket));
      await srv.redis.zadd(`mm:queue:${ticket.sheetId}`, agedTime, u.id);
    }

    const matchFoundPromise = botC.waitForEvent<{ matchId: string }>('match:found');

    // Run tick again -> now delta (350) <= window (400), should pair!
    await srv.matchmakingService.tick();

    const matchFound = await matchFoundPromise;
    expect(matchFound.matchId).toBeDefined();

    botC.disconnect();
    botD.disconnect();
  });

  it('suppresses pairing against recent opponents until wait time exceeds 60s', async () => {
    const userE = await createVerifiedUser('recent_e', 1400);
    const userF = await createVerifiedUser('recent_f', 1410);

    const sheet = await srv.prisma.levelSheet.findUniqueOrThrow({ where: { slug: 'sheet-m6' } });

    // Seed 3 prior finished matches between E and F
    for (let i = 0; i < 3; i++) {
      const pastMatch = await srv.prisma.match.create({
        data: {
          sheetId: sheet.id,
          mode: 'RANKED',
          status: 'FINISHED',
          questionCount: 3,
          createdAt: new Date(Date.now() - (10 - i) * 60_000),
          finishedAt: new Date(Date.now() - (9 - i) * 60_000),
        },
      });

      await srv.prisma.matchPlayer.createMany({
        data: [
          {
            matchId: pastMatch.id,
            userId: userE.id,
            handleNorm: 'recent_e',
            ratingBefore: 1400,
            totalScore: 1000,
          },
          {
            matchId: pastMatch.id,
            userId: userF.id,
            handleNorm: 'recent_f',
            ratingBefore: 1410,
            totalScore: 800,
          },
        ],
      });
    }

    const tokenE = userToken(userE);
    const tokenF = userToken(userF);

    const botE = new BotClient({ url: serverUrl, token: tokenE });
    const botF = new BotClient({ url: serverUrl, token: tokenF });

    await botE.connect();
    await botF.connect();

    await botE.joinQueue('sheet-m6');
    await botF.joinQueue('sheet-m6');

    // Tick with wait time 0 -> should NOT pair due to 3 recent matches
    await srv.matchmakingService.tick();

    const activeE = await srv.redis.get(`active:${userE.id}`);
    expect(activeE).toMatch(/^queue:/);

    // Fast-forward user E's wait time to 65 seconds ago (exceeds 60s waive threshold)
    const agedTime = Date.now() - 65_000;
    const ticketRaw = await srv.redis.get(`mm:ticket:${userE.id}`);
    const ticket = JSON.parse(ticketRaw!);
    ticket.enqueuedAtMs = agedTime;
    await srv.redis.set(`mm:ticket:${userE.id}`, JSON.stringify(ticket));
    await srv.redis.zadd(`mm:queue:${ticket.sheetId}`, agedTime, userE.id);

    const matchFoundPromise = botE.waitForEvent<{ matchId: string }>('match:found');

    // Tick again -> waiver applies, should pair!
    await srv.matchmakingService.tick();

    const matchFound = await matchFoundPromise;
    expect(matchFound.matchId).toBeDefined();

    botE.disconnect();
    botF.disconnect();
  });

  it('enforces single activity guard and prevents concurrent queue/room participation', async () => {
    const userG = await createVerifiedUser('guard_g', 1300);
    const tokenG = userToken(userG);

    const botG = new BotClient({ url: serverUrl, token: tokenG });
    await botG.connect();

    // 1. Join queue
    const res1 = await botG.joinQueue('sheet-m6');
    expect(res1.ok).toBe(true);

    // 2. Attempt to join queue again -> rejected
    const res2 = await botG.joinQueue('sheet-m6');
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('already in an active queue');

    // 3. Attempt to create room -> rejected
    const resRoom = await botG.createRoom('sheet-m6');
    expect(resRoom.ok).toBe(false);
    expect(resRoom.error).toContain('already in an active queue');

    // 4. Leave queue
    const resLeave = await botG.leaveQueue();
    expect(resLeave.ok).toBe(true);

    const activeAfterLeave = await srv.redis.get(`active:${userG.id}`);
    expect(activeAfterLeave).toBeNull();

    // 5. Now creating a room succeeds
    const resRoom2 = await botG.createRoom('sheet-m6');
    expect(resRoom2.ok).toBe(true);
    expect(resRoom2.roomCode).toBeDefined();

    botG.disconnect();
  });

  it('creates and joins private custom rooms, entering LOBBY and starting on mutual ready', async () => {
    const userH = await createVerifiedUser('room_h', 1400);
    const userI = await createVerifiedUser('room_i', 1450);

    const tokenH = userToken(userH);
    const tokenI = userToken(userI);

    const botH = new BotClient({ url: serverUrl, token: tokenH });
    const botI = new BotClient({ url: serverUrl, token: tokenI });

    await botH.connect();
    await botI.connect();

    // 1. Creator creates room
    const createRes = await botH.createRoom('sheet-m6', 3);
    expect(createRes.ok).toBe(true);
    expect(createRes.roomCode).toBeDefined();
    expect(createRes.roomCode).toHaveLength(6);

    const roomCode = createRes.roomCode!;

    // 2. Both listen for match:found
    const foundPromiseH = botH.waitForEvent<{ matchId: string }>('match:found');
    const foundPromiseI = botI.waitForEvent<{ matchId: string }>('match:found');

    // 3. Joiner joins room
    const joinRes = await botI.joinRoom(roomCode);
    expect(joinRes.ok).toBe(true);
    expect(joinRes.matchId).toBeDefined();

    const [foundH, foundI] = await Promise.all([foundPromiseH, foundPromiseI]);
    expect(foundH.matchId).toBe(joinRes.matchId);
    expect(foundI.matchId).toBe(joinRes.matchId);

    // 4. Verify match is in LOBBY mode
    const stateLobby = await botH.waitForState((s) => s.status === 'LOBBY');
    expect(stateLobby.status).toBe('LOBBY');
    expect(stateLobby.mode).toBe('PRIVATE');
    expect(stateLobby.questionCount).toBe(3);

    // 5. Creator signals ready
    const readyH = await botH.ready();
    expect(readyH.ok).toBe(true);

    // 6. Joiner signals ready -> triggers transition to COUNTDOWN
    const readyI = await botI.ready();
    expect(readyI.ok).toBe(true);

    const stateCountdown = await botH.waitForState((s) => s.status === 'COUNTDOWN');
    expect(stateCountdown.status).toBe('COUNTDOWN');

    botH.disconnect();
    botI.disconnect();
  });

  it('handles socket disconnect by automatically removing queued tickets', async () => {
    const userDrop = await createVerifiedUser('drop_user', 1350);
    const tokenDrop = userToken(userDrop);

    const botDrop = new BotClient({ url: serverUrl, token: tokenDrop });
    await botDrop.connect();

    await botDrop.joinQueue('sheet-m6');
    const activeBefore = await srv.redis.get(`active:${userDrop.id}`);
    expect(activeBefore).toMatch(/^queue:/);

    // Disconnect socket
    botDrop.disconnect();

    // Wait a brief moment for disconnect handler to finish
    await new Promise((r) => setTimeout(r, 200));

    const activeAfter = await srv.redis.get(`active:${userDrop.id}`);
    expect(activeAfter).toBeNull();
    const ticket = await srv.redis.get(`mm:ticket:${userDrop.id}`);
    expect(ticket).toBeNull();
  });

  it('detects no-show presence timeout, aborts match and requeues connected player', async () => {
    const userPresent = await createVerifiedUser('present_p', 1500);
    const userAbsent = await createVerifiedUser('absent_a', 1510);

    const tokenPresent = userToken(userPresent);
    const botPresent = new BotClient({ url: serverUrl, token: tokenPresent });
    await botPresent.connect();

    // Enqueue both (userAbsent manually via service to avoid socket disconnect cleanup)
    const originalEnqueueTime = Date.now() - 5000;
    const resP = await srv.matchmakingService.joinQueue(
      userPresent.id,
      'sheet-m6',
      originalEnqueueTime,
    );
    expect(resP.ok).toBe(true);
    const resA = await srv.matchmakingService.joinQueue(userAbsent.id, 'sheet-m6');
    expect(resA.ok).toBe(true);

    // Tick to pair them
    await srv.matchmakingService.tick();

    const activePresent = await srv.redis.get(`active:${userPresent.id}`);
    expect(activePresent).toMatch(/^match:/);
    const matchId = activePresent!.slice('match:'.length);

    // Verify present player is marked connected
    const activeMatch = srv.matchEngine.getActiveMatch(matchId);
    expect(activeMatch).toBeDefined();
    expect(activeMatch!.players[userPresent.id]!.connected).toBe(true);
    expect(activeMatch!.players[userAbsent.id]!.connected).toBe(false);

    // Wait for the configured no-show timeout (MATCH_NO_SHOW_TIMEOUT_MS = 1000)
    await new Promise((r) => setTimeout(r, 1300));

    // Match should be ABORTED with ABORT_NO_SHOW
    const finishedMatch = await srv.prisma.match.findUnique({ where: { id: matchId } });
    expect(finishedMatch?.status).toBe('ABORTED');
    expect(finishedMatch?.endReason).toBe('ABORT_NO_SHOW');

    // Present player should be returned to queue with original enqueue timestamp!
    const requeuedActive = await srv.redis.get(`active:${userPresent.id}`);
    expect(requeuedActive).toMatch(/^queue:/);

    const requeuedTicketRaw = await srv.redis.get(`mm:ticket:${userPresent.id}`);
    expect(requeuedTicketRaw).toBeDefined();
    const requeuedTicket = JSON.parse(requeuedTicketRaw!);
    expect(requeuedTicket.enqueuedAtMs).toBe(originalEnqueueTime);

    // Absent player should NOT be in queue
    const absentActive = await srv.redis.get(`active:${userAbsent.id}`);
    expect(absentActive).toBeNull();

    botPresent.disconnect();
  });

  it('returns null from /api/me/active-match when player has no active match', async () => {
    const idleUser = await createVerifiedUser('idle_user', 1200);
    const token = userToken(idleUser);

    const res = await request(srv.server)
      .get('/api/me/active-match')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.match).toBeNull();
  });
});
