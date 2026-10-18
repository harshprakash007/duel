import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FakeCodeforcesServer } from '@duel/cf-client/fake';
import { CfClient } from '@duel/cf-client';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { cleanDb, testEnv } from './env';
import { seedLevelSheets } from '../../src/modules/sheets/seed';
import type { CfProblem, CfProblemStatistics, CfSubmission } from '@duel/cf-client';

describe('Catalog, Sheets, Solved-Set & Picker Integration', () => {
  let srv: RunningServer;
  let fakeCf: FakeCodeforcesServer;
  let adminCookie: string;
  let userCookie: string;
  let user1Id: string;
  let user2Id: string;

  beforeAll(async () => {
    fakeCf = new FakeCodeforcesServer();
    const fakeUrl = await fakeCf.start();

    const cfClient = new CfClient({
      baseUrl: fakeUrl,
      userAgent: 'DuelTest/1.0',
      maxRps: 100,
      timeoutMs: 2000,
    });

    srv = await startServer(loadConfig(testEnv()), { cfClient });
    await srv.redis.flushdb();
    await cleanDb(srv.prisma);

    const getCookie = (res: request.Response) => {
      const c = res.headers['set-cookie'];
      if (!c) return '';
      return Array.isArray(c) ? (c[0] ?? '') : c;
    };

    // Register admin user
    const adminReg = await request(srv.server).post('/api/auth/register').send({
      email: 'admin@example.com',
      password: 'AdminPassword123!',
      displayName: 'Admin User',
    });
    adminCookie = getCookie(adminReg);
    const adminId = adminReg.body.user.id;
    // Elevate to ADMIN role
    await srv.prisma.user.update({
      where: { id: adminId },
      data: { role: 'ADMIN' },
    });

    // Re-login as admin to refresh JWT role payload
    const adminLogin = await request(srv.server).post('/api/auth/login').send({
      email: 'admin@example.com',
      password: 'AdminPassword123!',
    });
    adminCookie = getCookie(adminLogin);

    // Register normal users
    const u1Reg = await request(srv.server).post('/api/auth/register').send({
      email: 'u1@example.com',
      password: 'UserPassword123!',
      displayName: 'User One',
    });
    userCookie = getCookie(u1Reg);
    user1Id = u1Reg.body.user.id;

    const u2Reg = await request(srv.server).post('/api/auth/register').send({
      email: 'u2@example.com',
      password: 'UserPassword123!',
      displayName: 'User Two',
    });
    user2Id = u2Reg.body.user.id;

    // Seed Level Sheets L1–L6
    await seedLevelSheets(srv.prisma);
  });

  afterAll(async () => {
    await srv.close();
    await fakeCf.close();
  });

  describe('Sheets API', () => {
    it('lists seeded sheets via GET /api/sheets', async () => {
      const res = await request(srv.server).get('/api/sheets');
      expect(res.status).toBe(200);
      expect(res.body.sheets).toHaveLength(6);
      expect(res.body.sheets[0]).toMatchObject({
        slug: 'l1-warmup',
        name: 'L1 Warm-up',
        minRating: 800,
        maxRating: 1000,
        problemCount: 0,
      });
    });

    it('gets a single sheet by slug via GET /api/sheets/:slug', async () => {
      const res = await request(srv.server).get('/api/sheets/l1-warmup');
      expect(res.status).toBe(200);
      expect(res.body.sheet).toMatchObject({
        slug: 'l1-warmup',
        name: 'L1 Warm-up',
        minRating: 800,
        maxRating: 1000,
      });
    });

    it('returns 404 for unknown sheet slug', async () => {
      const res = await request(srv.server).get('/api/sheets/nonexistent-sheet');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Admin Sheets Management', () => {
    it('rejects sheet creation without authentication', async () => {
      const res = await request(srv.server).post('/api/admin/sheets').send({
        slug: 'custom-sheet',
        name: 'Custom Sheet',
        minRating: 1500,
        maxRating: 1800,
      });
      expect(res.status).toBe(401);
    });

    it('rejects sheet creation by non-admin user', async () => {
      const res = await request(srv.server)
        .post('/api/admin/sheets')
        .set('Cookie', userCookie)
        .send({
          slug: 'custom-sheet',
          name: 'Custom Sheet',
          minRating: 1500,
          maxRating: 1800,
        });
      expect(res.status).toBe(403);
    });

    let createdSheetId: string;

    it('allows admin to create a new sheet', async () => {
      const res = await request(srv.server)
        .post('/api/admin/sheets')
        .set('Cookie', adminCookie)
        .send({
          slug: 'custom-sheet',
          name: 'Custom Sheet',
          minRating: 1500,
          maxRating: 1800,
          minSolvedCount: 200,
          questionCount: 3,
        });

      expect(res.status).toBe(201);
      expect(res.body.sheet).toMatchObject({
        slug: 'custom-sheet',
        name: 'Custom Sheet',
        minRating: 1500,
        maxRating: 1800,
        minSolvedCount: 200,
      });
      createdSheetId = res.body.sheet.id;
    });

    it('allows admin to update a sheet', async () => {
      const res = await request(srv.server)
        .patch(`/api/admin/sheets/${createdSheetId}`)
        .set('Cookie', adminCookie)
        .send({
          name: 'Updated Custom Sheet',
          minSolvedCount: 250,
        });

      expect(res.status).toBe(200);
      expect(res.body.sheet).toMatchObject({
        name: 'Updated Custom Sheet',
        minSolvedCount: 250,
      });
    });
  });

  describe('Problem Catalog Sync', () => {
    it('syncs problems from Codeforces and updates problem counts', async () => {
      // Seed problems on fake CF
      const testProblems: CfProblem[] = [
        {
          contestId: 100,
          index: 'A',
          name: 'L1 Problem 1',
          type: 'PROGRAMMING',
          rating: 800,
          tags: ['implementation'],
        },
        {
          contestId: 100,
          index: 'B',
          name: 'L1 Problem 2',
          type: 'PROGRAMMING',
          rating: 900,
          tags: ['math'],
        },
        {
          contestId: 100,
          index: 'C',
          name: 'L1 Problem 3',
          type: 'PROGRAMMING',
          rating: 1000,
          tags: ['greedy'],
        },
        {
          contestId: 100,
          index: 'D',
          name: 'Excluded Tag Problem',
          type: 'PROGRAMMING',
          rating: 900,
          tags: ['*special'], // Excluded by CATALOG_DEFAULTS.excludeTags
        },
        {
          contestId: 100,
          index: 'E',
          name: 'Question Problem',
          type: 'QUESTION', // Non-programming, must be skipped
          rating: 800,
          tags: ['math'],
        },
      ];

      const testStats: CfProblemStatistics[] = [
        { contestId: 100, index: 'A', solvedCount: 500 },
        { contestId: 100, index: 'B', solvedCount: 450 },
        { contestId: 100, index: 'C', solvedCount: 350 },
        { contestId: 100, index: 'D', solvedCount: 400 },
        { contestId: 100, index: 'E', solvedCount: 100 },
      ];

      fakeCf.seedProblems(testProblems, testStats);

      // Trigger sync via admin endpoint
      const syncRes = await request(srv.server)
        .post('/api/admin/problems/sync')
        .set('Cookie', adminCookie);

      expect(syncRes.status).toBe(200);
      expect(syncRes.body.ok).toBe(true);
      expect(syncRes.body.result.totalReceived).toBe(5);
      expect(syncRes.body.result.upsertedCount).toBe(3); // 3 valid programming problems

      // Verify problems in DB
      const dbProblems = await srv.prisma.problem.findMany({
        where: { contestId: 100 },
        orderBy: { index: 'asc' },
      });
      expect(dbProblems).toHaveLength(3);
      expect(dbProblems.map((p) => p.index)).toEqual(['A', 'B', 'C']);

      // Check problem counts on L1 sheet
      const sheetRes = await request(srv.server).get('/api/sheets/l1-warmup');
      expect(sheetRes.status).toBe(200);
      expect(sheetRes.body.sheet.problemCount).toBe(3);
    });

    it('deactivates missing problems on subsequent sync', async () => {
      // Re-seed fake CF with only 2 problems (problem 100-C removed)
      const remainingProblems: CfProblem[] = [
        {
          contestId: 100,
          index: 'A',
          name: 'L1 Problem 1',
          type: 'PROGRAMMING',
          rating: 800,
          tags: ['implementation'],
        },
        {
          contestId: 100,
          index: 'B',
          name: 'L1 Problem 2',
          type: 'PROGRAMMING',
          rating: 900,
          tags: ['math'],
        },
      ];
      const remainingStats: CfProblemStatistics[] = [
        { contestId: 100, index: 'A', solvedCount: 500 },
        { contestId: 100, index: 'B', solvedCount: 450 },
      ];

      fakeCf.clearProblems();
      fakeCf.seedProblems(remainingProblems, remainingStats);

      const syncRes = await request(srv.server)
        .post('/api/admin/problems/sync')
        .set('Cookie', adminCookie);

      expect(syncRes.status).toBe(200);
      expect(syncRes.body.result.deactivatedCount).toBe(1);

      const deactivated = await srv.prisma.problem.findUnique({
        where: { contestId_index: { contestId: 100, index: 'C' } },
      });
      expect(deactivated?.isActive).toBe(false);
    });
  });

  describe('SolvedSetService', () => {
    it('incrementally crawls and stores user solved problems', async () => {
      const handle = 'testsolver';
      fakeCf.seedUser({ handle, rating: 1500 });

      // Link handle for user1
      await srv.prisma.cfHandle.create({
        data: {
          userId: user1Id,
          handle,
          handleNorm: handle.toLowerCase(),
          verifiedAt: new Date(),
        },
      });

      // Add submissions to fake CF: 1 OK, 1 WA
      const sub1: CfSubmission = {
        id: 5001n,
        creationTimeSeconds: 1700000000,
        problem: { contestId: 100, index: 'A', name: 'L1 Problem 1', tags: [] },
        author: { members: [{ handle }] },
        verdict: 'OK',
      };
      const sub2: CfSubmission = {
        id: 5002n,
        creationTimeSeconds: 1700000100,
        problem: { contestId: 100, index: 'B', name: 'L1 Problem 2', tags: [] },
        author: { members: [{ handle }] },
        verdict: 'WRONG_ANSWER',
      };
      fakeCf.addSubmission(sub1);
      fakeCf.addSubmission(sub2);

      const count = await srv.solvedSetService.syncUserSolved(user1Id, handle);
      expect(count).toBe(1); // Only 1 OK submission

      const solved = await srv.prisma.userSolved.findMany({ where: { userId: user1Id } });
      expect(solved).toHaveLength(1);
      expect(solved[0]).toMatchObject({
        contestId: 100,
        index: 'A',
      });

      const cfHandle = await srv.prisma.cfHandle.findUnique({ where: { userId: user1Id } });
      expect(cfHandle?.solvedSyncedUpToId).toBe(5002n);

      // Now add another OK submission
      const sub3: CfSubmission = {
        id: 5003n,
        creationTimeSeconds: 1700000200,
        problem: { contestId: 100, index: 'B', name: 'L1 Problem 2', tags: [] },
        author: { members: [{ handle }] },
        verdict: 'OK',
      };
      fakeCf.addSubmission(sub3);

      const count2 = await srv.solvedSetService.syncUserSolved(user1Id, handle);
      expect(count2).toBe(1);

      const allSolved = await srv.prisma.userSolved.findMany({ where: { userId: user1Id } });
      expect(allSolved).toHaveLength(2);
      expect(allSolved.map((s) => s.index).sort()).toEqual(['A', 'B']);
    });
  });

  describe('PickerService', () => {
    it('picks problems excluding solved problems and recent matches', async () => {
      // Reactivate 100-C and add more problems so we have enough
      await srv.prisma.problem.upsert({
        where: { contestId_index: { contestId: 100, index: 'C' } },
        update: { isActive: true },
        create: {
          contestId: 100,
          index: 'C',
          name: 'L1 Problem 3',
          rating: 1000,
          tags: ['greedy'],
          solvedCount: 350,
          isActive: true,
          syncedAt: new Date(),
        },
      });

      await srv.prisma.problem.createMany({
        data: [
          {
            contestId: 101,
            index: 'A',
            name: 'L1 Problem 4',
            rating: 800,
            tags: ['math'],
            solvedCount: 500,
            isActive: true,
            syncedAt: new Date(),
          },
          {
            contestId: 101,
            index: 'B',
            name: 'L1 Problem 5',
            rating: 900,
            tags: ['dp'],
            solvedCount: 400,
            isActive: true,
            syncedAt: new Date(),
          },
          {
            contestId: 101,
            index: 'C',
            name: 'L1 Problem 6',
            rating: 1000,
            tags: ['strings'],
            solvedCount: 600,
            isActive: true,
            syncedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });

      const l1Sheet = await srv.prisma.levelSheet.findUniqueOrThrow({
        where: { slug: 'l1-warmup' },
      });

      // User1 has solved 100-A and 100-B.
      // Available L1 active problems:
      // 100-A (solved by user1) -> EXCLUDED
      // 100-B (solved by user1) -> EXCLUDED
      // 100-C (rating 1000)
      // 101-A (rating 800)
      // 101-B (rating 900)
      // 101-C (rating 1000)

      const picked = await srv.pickerService.pick(l1Sheet, user1Id, user2Id, 3);
      expect(picked).toHaveLength(3);
      const keys = picked.map((p) => `${p.contestId}-${p.index}`);
      expect(keys).not.toContain('100-A');
      expect(keys).not.toContain('100-B');

      // Now create a match where user2 recently played 101-A
      const prob101A = await srv.prisma.problem.findUniqueOrThrow({
        where: { contestId_index: { contestId: 101, index: 'A' } },
      });

      const match = await srv.prisma.match.create({
        data: {
          sheetId: l1Sheet.id,
          status: 'FINISHED',
          mode: 'RANKED',
          questionCount: 3,
          startedAt: new Date(),
          players: {
            create: [
              { userId: user2Id, handleNorm: 'u2', ratingBefore: 1000 },
              { userId: user1Id, handleNorm: 'u1', ratingBefore: 1000 },
            ],
          },
          questions: {
            create: [
              {
                idx: 0,
                problemId: prob101A.id,
              },
            ],
          },
        },
      });
      expect(match).toBeDefined();

      // Now 101-A should also be excluded due to recent match history
      const picked2 = await srv.pickerService.pick(l1Sheet, user1Id, user2Id, 3);
      expect(picked2).toHaveLength(3);
      const keys2 = picked2.map((p) => `${p.contestId}-${p.index}`);
      expect(keys2).not.toContain('101-A');
    });

    it('aborts match creation with ABORT_NO_PROBLEMS when eligible candidate count is insufficient', async () => {
      // Create a restrictive sheet where only 1 problem qualifies
      const restrictiveSheet = await srv.prisma.levelSheet.create({
        data: {
          slug: 'empty-sheet',
          name: 'Empty Sheet',
          minRating: 3000,
          maxRating: 3500,
          minSolvedCount: 300,
          questionCount: 3,
        },
      });

      await expect(srv.pickerService.pick(restrictiveSheet, user1Id, user2Id, 3)).rejects.toThrow(
        /ABORT_NO_PROBLEMS/,
      );
    });
  });
});
