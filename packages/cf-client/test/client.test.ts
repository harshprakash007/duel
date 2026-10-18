import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCodeforcesServer } from '../src/fake/server';
import { CfClient, CfUserNotFoundError } from '../src/client';
import type { CfProblem, CfSubmission } from '../src/types';

describe('CfClient Contract with FakeCodeforcesServer', () => {
  let fakeServer: FakeCodeforcesServer;
  let baseUrl: string;
  let client: CfClient;

  beforeAll(async () => {
    fakeServer = new FakeCodeforcesServer();
    baseUrl = await fakeServer.start();
  });

  afterAll(async () => {
    await fakeServer.close();
  });

  beforeEach(() => {
    fakeServer.reset();
    client?.destroy();
    client = new CfClient({
      baseUrl,
      userAgent: 'TestClient/1.0',
      maxRps: 50,
      timeoutMs: 1000,
      retryMax: 2,
      retryBaseMs: 10,
      retryMaxDelayMs: 50,
      degradedAfterFailures: 3,
    });
  });

  it('fetches problemset problems and statistics with schema validation', async () => {
    const problem: CfProblem = {
      contestId: 1,
      index: 'A',
      name: 'Theatre Square',
      type: 'PROGRAMMING',
      rating: 1000,
      tags: ['math'],
    };
    fakeServer.seedProblem(problem, { solvedCount: 500 });

    const result = await client.problemsetProblems();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.name).toBe('Theatre Square');
    expect(result.problemStatistics).toHaveLength(1);
    expect(result.problemStatistics[0]!.solvedCount).toBe(500);
  });

  it('fetches user info and handles unknown properties', async () => {
    fakeServer.seedUser({
      handle: 'tourist',
      rating: 3800,
      maxRating: 4000,
      rank: 'legendary grandmaster',
    });

    const users = await client.userInfo(['tourist']);
    expect(users).toHaveLength(1);
    expect(users[0]!.handle).toBe('tourist');
    expect(users[0]!.rating).toBe(3800);
  });

  it('throws CfUserNotFoundError when user does not exist', async () => {
    await expect(client.userInfo(['nonexistent_user_xyz'])).rejects.toThrow(CfUserNotFoundError);
  });

  it('fetches recent submissions with BigInt IDs', async () => {
    const sub: CfSubmission = {
      id: 999999999999n,
      creationTimeSeconds: 1600000000,
      problem: { contestId: 1, index: 'A', name: 'Theatre Square', tags: [] },
      author: { members: [{ handle: 'tourist' }] },
      verdict: 'OK',
    };
    fakeServer.addSubmission(sub);

    const submissions = await client.problemsetRecentStatus(10);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.id).toBe(999999999999n);
    expect(submissions[0]!.verdict).toBe('OK');
  });

  it('fetches user submissions with pagination', async () => {
    const sub: CfSubmission = {
      id: 12345n,
      creationTimeSeconds: 1600000000,
      problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
      author: { members: [{ handle: 'petr' }] },
      verdict: 'OK',
    };
    fakeServer.addSubmission(sub);

    const userSubs = await client.userStatus('petr', 1, 5);
    expect(userSubs).toHaveLength(1);
    expect(userSubs[0]!.id).toBe(12345n);
  });

  it('retries on rate-limit failures and succeeds', async () => {
    fakeServer.seedUser({ handle: 'test_retry' });
    // Fail first 2 calls with rate-limit, then succeed
    fakeServer.failNext(2, 'rate-limit');

    const users = await client.userInfo(['test_retry']);
    expect(users).toHaveLength(1);
    expect(users[0]!.handle).toBe('test_retry');
  });

  it('retries on 500 server error and succeeds', async () => {
    fakeServer.seedUser({ handle: 'test_500' });
    fakeServer.failNext(1, '500');

    const users = await client.userInfo(['test_500']);
    expect(users).toHaveLength(1);
  });

  it('circuit breaker triggers DEGRADED after consecutive failures and recovers on success', async () => {
    const stateChanges: string[] = [];
    client.on('stateChange', (s) => stateChanges.push(s));

    fakeServer.setOutage(true);

    // Threshold is 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(client.userInfo(['a'])).rejects.toThrow();
    }

    expect(client.getCircuitState()).toBe('DEGRADED');
    expect(client.isDegraded()).toBe(true);
    expect(stateChanges).toEqual(['DEGRADED']);

    // End outage
    fakeServer.setOutage(false);
    fakeServer.seedUser({ handle: 'a' });

    const users = await client.userInfo(['a']);
    expect(users).toHaveLength(1);
    expect(client.getCircuitState()).toBe('OK');
    expect(client.isDegraded()).toBe(false);
    expect(stateChanges).toEqual(['DEGRADED', 'OK']);
  });

  it('times out when request exceeds timeoutMs', async () => {
    fakeServer.failNext(1, 'timeout');
    const shortTimeoutClient = new CfClient({
      baseUrl,
      userAgent: 'TestClient/1.0',
      timeoutMs: 100,
      retryMax: 0,
    });

    await expect(shortTimeoutClient.userInfo(['a'])).rejects.toThrow(/timed out/i);
    shortTimeoutClient.destroy();
  });
});
