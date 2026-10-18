import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FakeCodeforcesServer } from '@duel/cf-client/fake';
import { CfClient } from '@duel/cf-client';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { testEnv } from './env';
import type { CfSubmission } from '@duel/cf-client';

describe('Handles API Integration with FakeCodeforcesServer', () => {
  let srv: RunningServer;
  let fakeCf: FakeCodeforcesServer;
  let user1Cookie: string;
  let user2Cookie: string;

  beforeAll(async () => {
    fakeCf = new FakeCodeforcesServer();
    const fakeUrl = await fakeCf.start();

    // Custom CfClient pointing at fake server with fast rate limits for testing
    const cfClient = new CfClient({
      baseUrl: fakeUrl,
      userAgent: 'DuelTest/1.0',
      maxRps: 100,
      timeoutMs: 2000,
    });

    srv = await startServer(loadConfig(testEnv()), { cfClient });

    // Seed test users in DB
    await srv.prisma.user.deleteMany();

    const getCookie = (res: request.Response) => {
      const c = res.headers['set-cookie'];
      if (!c) return '';
      return Array.isArray(c) ? (c[0] ?? '') : c;
    };

    const reg1 = await request(srv.server).post('/api/auth/register').send({
      email: 'coder1@example.com',
      password: 'Password123!',
      displayName: 'Coder 1',
    });
    user1Cookie = getCookie(reg1);

    const reg2 = await request(srv.server).post('/api/auth/register').send({
      email: 'coder2@example.com',
      password: 'Password123!',
      displayName: 'Coder 2',
    });
    user2Cookie = getCookie(reg2);
  });

  afterAll(async () => {
    await srv.close();
    await fakeCf.close();
  });

  it('rejects link start without authentication', async () => {
    const res = await request(srv.server)
      .post('/api/handles/link/start')
      .send({ handle: 'tourist' });

    expect(res.status).toBe(401);
  });

  it('rejects link start when handle does not exist on Codeforces', async () => {
    const res = await request(srv.server)
      .post('/api/handles/link/start')
      .set('Cookie', user1Cookie)
      .send({ handle: 'nonexistent_handle_xyz' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CF_NOT_FOUND');
  });

  let assignedProblem: { contestId: number; index: string };

  it('starts handle linking when handle exists on Codeforces', async () => {
    fakeCf.seedUser({ handle: 'tourist', rating: 3500 });

    const res = await request(srv.server)
      .post('/api/handles/link/start')
      .set('Cookie', user1Cookie)
      .send({ handle: 'tourist' });

    expect(res.status).toBe(200);
    expect(res.body.handle).toBe('tourist');
    expect(res.body.problem).toBeDefined();
    expect(res.body.instructions).toContain('non-compiling');

    assignedProblem = res.body.problem;
  });

  it('fails verification when no submission has been made', async () => {
    const res = await request(srv.server)
      .post('/api/handles/link/verify')
      .set('Cookie', user1Cookie);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VERIFICATION_FAILED');
  });

  it('fails verification when submission is not COMPILATION_ERROR', async () => {
    const sub: CfSubmission = {
      id: 1001n,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      problem: {
        contestId: assignedProblem.contestId,
        index: assignedProblem.index,
        name: 'Test Problem',
        tags: [],
      },
      author: { members: [{ handle: 'tourist' }] },
      verdict: 'WRONG_ANSWER',
    };
    fakeCf.addSubmission(sub);

    const res = await request(srv.server)
      .post('/api/handles/link/verify')
      .set('Cookie', user1Cookie);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VERIFICATION_FAILED');
  });

  it('fails verification when submission is on a different problem', async () => {
    const sub: CfSubmission = {
      id: 1002n,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      problem: {
        contestId: 99999,
        index: 'Z',
        name: 'Wrong Problem',
        tags: [],
      },
      author: { members: [{ handle: 'tourist' }] },
      verdict: 'COMPILATION_ERROR',
    };
    fakeCf.addSubmission(sub);

    const res = await request(srv.server)
      .post('/api/handles/link/verify')
      .set('Cookie', user1Cookie);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VERIFICATION_FAILED');
  });

  it('successfully verifies handle on COMPILATION_ERROR and seeds rating', async () => {
    const sub: CfSubmission = {
      id: 1003n,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      problem: {
        contestId: assignedProblem.contestId,
        index: assignedProblem.index,
        name: 'Assigned Problem',
        tags: [],
      },
      author: { members: [{ handle: 'tourist' }] },
      verdict: 'COMPILATION_ERROR',
    };
    fakeCf.addSubmission(sub);

    const res = await request(srv.server)
      .post('/api/handles/link/verify')
      .set('Cookie', user1Cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      handle: 'tourist',
      // tourist rating was 3500; clamped to RATING_INIT_MAX = 2400 (§7)
      rating: 2400,
    });
  });

  it('rejects starting link again for an already linked user', async () => {
    const res = await request(srv.server)
      .post('/api/handles/link/start')
      .set('Cookie', user1Cookie)
      .send({ handle: 'petr' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDLE_ALREADY_LINKED');
  });

  it('rejects another user attempting to link the already taken handle', async () => {
    const res = await request(srv.server)
      .post('/api/handles/link/start')
      .set('Cookie', user2Cookie)
      .send({ handle: 'TOURIST' }); // case-insensitive check

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HANDLE_TAKEN');
  });

  it('returns linked handle details via /api/handles/me', async () => {
    const res = await request(srv.server).get('/api/handles/me').set('Cookie', user1Cookie);

    expect(res.status).toBe(200);
    expect(res.body.handle).toMatchObject({
      handle: 'tourist',
      rating: 2400,
      matchesPlayed: 0,
      peakRating: 2400,
    });
    expect(res.body.pendingVerification).toBeNull();
  });
});
