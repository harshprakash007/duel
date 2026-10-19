import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { signAuthToken } from '../../src/modules/auth/jwt';
import { createPrisma } from '../../src/db/prisma';

describe('Production Hardening, Compliance, Admin & Metrics (M9)', () => {
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

    const sheet = await srv.prisma.levelSheet.create({
      data: {
        slug: 'sheet-m9',
        name: 'M9 Sheet',
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
          id: 9001,
          contestId: 900,
          index: 'A',
          name: 'Hardening Prob 1',
          rating: 900,
          tags: ['implementation'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 9002,
          contestId: 900,
          index: 'B',
          name: 'Hardening Prob 2',
          rating: 1100,
          tags: ['math'],
          solvedCount: 100,
          syncedAt: new Date(),
        },
        {
          id: 9003,
          contestId: 900,
          index: 'C',
          name: 'Hardening Prob 3',
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
    await srv.close();
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

  it('anonymizes and soft-deletes user account on DELETE /api/me', async () => {
    // 1. Create a user with linked CF handle and rating
    const user = await srv.prisma.user.create({
      data: {
        email: 'to-delete@example.com',
        displayName: 'DeleteMeUser',
        passwordHash: 'dummyhash',
        role: 'USER',
        rating: {
          create: {
            rating: 1200,
            peakRating: 1200,
            matchesPlayed: 2,
            wins: 1,
            losses: 1,
          },
        },
        handle: {
          create: {
            handle: 'del_handle_99',
            handleNorm: 'del_handle_99',
            verifiedAt: new Date(),
          },
        },
      },
    });

    const token = createTestToken(user);

    // Verify user can access /api/auth/me initially
    const preRes = await request(serverUrl)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(preRes.status).toBe(200);
    expect(preRes.body.user.email).toBe('to-delete@example.com');

    // 2. Request account deletion
    const delRes = await request(serverUrl)
      .delete('/api/me')
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // 3. Verify user record in database is anonymized
    const dbUser = await srv.prisma.user.findUnique({
      where: { id: user.id },
      include: { handle: true },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.deletedAt).not.toBeNull();
    expect(dbUser!.displayName).toBe('Deleted User');
    expect(dbUser!.email).toBe(`deleted-${user.id}@duel.local`);
    expect(dbUser!.passwordHash).toBe('DELETED');
    expect(dbUser!.handle).toBeNull(); // CF handle record pruned

    // 4. Verify subsequent authenticated request is rejected (401)
    const postRes = await request(serverUrl)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(postRes.status).toBe(401);

    // 5. Verify calling delete again fails with 404
    const delAgainRes = await request(serverUrl)
      .delete('/api/me')
      .set('Authorization', `Bearer ${token}`);
    expect(delAgainRes.status).toBe(404);
  });

  it('allows participants to report matches and enables admin moderation review', async () => {
    // 1. Create two players and an admin
    const p1 = await srv.prisma.user.create({
      data: {
        email: 'report-p1@test.com',
        displayName: 'ReportP1',
        passwordHash: 'dummy',
        handle: {
          create: { handle: 'rep_cf1', handleNorm: 'rep_cf1', verifiedAt: new Date() },
        },
      },
    });
    const p2 = await srv.prisma.user.create({
      data: {
        email: 'report-p2@test.com',
        displayName: 'ReportP2',
        passwordHash: 'dummy',
        handle: {
          create: { handle: 'rep_cf2', handleNorm: 'rep_cf2', verifiedAt: new Date() },
        },
      },
    });
    const outsider = await srv.prisma.user.create({
      data: {
        email: 'outsider@test.com',
        displayName: 'Outsider',
        passwordHash: 'dummy',
      },
    });
    const admin = await srv.prisma.user.create({
      data: {
        email: 'mod-admin@test.com',
        displayName: 'AdminMod',
        passwordHash: 'dummy',
        role: 'ADMIN',
      },
    });

    const match = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        sheetId,
        questionCount: 3,
        status: 'FINISHED',
        players: {
          create: [
            { userId: p1.id, handleNorm: 'rep_cf1', ratingBefore: 1200, totalScore: 800 },
            { userId: p2.id, handleNorm: 'rep_cf2', ratingBefore: 1200, totalScore: 200 },
          ],
        },
      },
    });

    const p1Token = createTestToken(p1);
    const outsiderToken = createTestToken(outsider);
    const adminToken = createTestToken(admin);

    // Non-participant attempt to report match -> 403 Forbidden
    const outsiderRes = await request(serverUrl)
      .post(`/api/matches/${match.id}/report`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ reason: 'I am just a spectator reporting this' });
    expect(outsiderRes.status).toBe(403);

    // Participant valid report -> 201 Created
    const reportRes = await request(serverUrl)
      .post(`/api/matches/${match.id}/report`)
      .set('Authorization', `Bearer ${p1Token}`)
      .send({ reason: 'Opponent solved instantly; suspected AI script' });
    expect(reportRes.status).toBe(201);
    expect(reportRes.body.status).toBe('OPEN');
    const reportId = reportRes.body.id;

    // Duplicate report attempt -> 409 Conflict
    const dupRes = await request(serverUrl)
      .post(`/api/matches/${match.id}/report`)
      .set('Authorization', `Bearer ${p1Token}`)
      .send({ reason: 'Duplicate report attempt' });
    expect(dupRes.status).toBe(409);

    // Admin views reports queue
    const listRes = await request(serverUrl)
      .get('/api/admin/reports?status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.reports.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.reports[0].id).toBe(reportId);
    expect(listRes.body.reports[0].reporterDisplayName).toBe('rep_cf1');

    // Admin resolves report
    const updateRes = await request(serverUrl)
      .patch(`/api/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.report.status).toBe('RESOLVED');
  });

  it('voids a ranked match and reverses player ratings atomically', async () => {
    // 1. Create two players with known ratings
    const userA = await srv.prisma.user.create({
      data: {
        email: 'void-a@test.com',
        displayName: 'VoidA',
        passwordHash: 'dummy',
        rating: {
          create: {
            rating: 1224, // Won +24
            peakRating: 1224,
            matchesPlayed: 1,
            wins: 1,
            losses: 0,
            draws: 0,
          },
        },
        handle: {
          create: { handle: 'void_a', handleNorm: 'void_a', verifiedAt: new Date() },
        },
      },
    });

    const userB = await srv.prisma.user.create({
      data: {
        email: 'void-b@test.com',
        displayName: 'VoidB',
        passwordHash: 'dummy',
        rating: {
          create: {
            rating: 1176, // Lost -24
            peakRating: 1200,
            matchesPlayed: 1,
            wins: 0,
            losses: 1,
            draws: 0,
          },
        },
        handle: {
          create: { handle: 'void_b', handleNorm: 'void_b', verifiedAt: new Date() },
        },
      },
    });

    const admin = await srv.prisma.user.create({
      data: {
        email: 'void-admin@test.com',
        displayName: 'VoidAdmin',
        passwordHash: 'dummy',
        role: 'ADMIN',
      },
    });

    // 2. Create the completed ranked match with rating history
    const match = await srv.prisma.match.create({
      data: {
        mode: 'RANKED',
        sheetId,
        questionCount: 3,
        status: 'FINISHED',
        winnerUserId: userA.id,
        endReason: 'COMPLETED',
        players: {
          create: [
            {
              userId: userA.id,
              handleNorm: 'void_a',
              ratingBefore: 1200,
              ratingAfter: 1224,
              totalScore: 800,
              result: 'WIN',
            },
            {
              userId: userB.id,
              handleNorm: 'void_b',
              ratingBefore: 1200,
              ratingAfter: 1176,
              totalScore: 200,
              result: 'LOSS',
            },
          ],
        },
        ratingHistory: {
          create: [
            { userId: userA.id, before: 1200, after: 1224, delta: 24 },
            { userId: userB.id, before: 1200, after: 1176, delta: -24 },
          ],
        },
      },
    });

    const adminToken = createTestToken(admin);

    // 3. Admin voids match
    const voidRes = await request(serverUrl)
      .post(`/api/admin/matches/${match.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.ok).toBe(true);
    expect(voidRes.body.reversed).toBe(true);

    // 4. Verify player ratings are reverted
    const prA = await srv.prisma.playerRating.findUnique({ where: { userId: userA.id } });
    const prB = await srv.prisma.playerRating.findUnique({ where: { userId: userB.id } });

    expect(prA!.rating).toBe(1200); // 1224 - 24 = 1200
    expect(prA!.wins).toBe(0);
    expect(prA!.matchesPlayed).toBe(0);

    expect(prB!.rating).toBe(1200); // 1176 - (-24) = 1200
    expect(prB!.losses).toBe(0);
    expect(prB!.matchesPlayed).toBe(0);

    // 5. Verify match status in DB is VOIDED / ABORTED
    const updatedMatch = await srv.prisma.match.findUnique({ where: { id: match.id } });
    expect(updatedMatch!.status).toBe('ABORTED');
    expect(updatedMatch!.endReason).toBe('VOIDED');

    // 6. Calling void again on already-voided match is safe (idempotent)
    const secondVoidRes = await request(serverUrl)
      .post(`/api/admin/matches/${match.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondVoidRes.status).toBe(200);
    expect(secondVoidRes.body.reversed).toBe(false);
  });

  it('exposes Prometheus metrics endpoint conforming to §18 format', async () => {
    const res = await request(serverUrl).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const body = res.text;
    expect(body).toContain('cf_requests_total');
    expect(body).toContain('cf_request_seconds');
    expect(body).toContain('active_matches');
    expect(body).toContain('active_sockets');
    expect(body).toContain('matchmaking_wait_seconds');
    expect(body).toContain('poller_cycle_seconds');
    expect(body).toContain('poller_detection_lag_seconds');
  });
});
