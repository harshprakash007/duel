import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeCodeforcesServer } from '@duel/cf-client/fake';
import { CfClient, type CfSubmission } from '@duel/cf-client';
import { createRedis, type Redis } from '../../src/db/redis';
import { loadConfig } from '../../src/config/index';
import { createLogger } from '../../src/lib/logger';
import { LeaderLock } from '../../src/lib/leader-lock';
import { PollerService } from '../../src/modules/poller/poller.service';
import type { PollerPendingEvent, PollerVerdictEvent } from '../../src/modules/poller/poller.types';
import { TEST_REDIS_URL, testEnv } from './env';

describe('Submission Poller & Leader Lock Integration', () => {
  let fakeCf: FakeCodeforcesServer;
  let cfClient: CfClient;
  let redis: Redis;
  const config = loadConfig(testEnv());
  const logger = createLogger(config);

  beforeAll(async () => {
    fakeCf = new FakeCodeforcesServer();
    const fakeUrl = await fakeCf.start();

    cfClient = new CfClient({
      baseUrl: fakeUrl,
      userAgent: 'DuelTest/1.0',
      maxRps: 100,
      timeoutMs: 2000,
    });

    redis = createRedis(TEST_REDIS_URL, 'poller-test');
    await redis.flushdb();
  });

  afterAll(async () => {
    cfClient.destroy();
    await fakeCf.close();
    await redis.quit();
  });

  describe('LeaderLock', () => {
    it('acquires, renews, and releases leadership with safe Lua semantics', async () => {
      const lockKey = 'lock:test-leader';
      let acquiredA = false;
      let lostA = false;

      const lockA = new LeaderLock({
        redis,
        lockKey,
        instanceId: 'node-A',
        ttlMs: 2000,
        renewMs: 500,
        logger,
        onAcquired: () => {
          acquiredA = true;
        },
        onLost: () => {
          lostA = true;
        },
      });

      const lockB = new LeaderLock({
        redis,
        lockKey,
        instanceId: 'node-B',
        ttlMs: 2000,
        renewMs: 500,
        logger,
      });

      // Node A acquires
      const wonA = await lockA.acquire();
      expect(wonA).toBe(true);
      expect(lockA.isLeader()).toBe(true);
      expect(acquiredA).toBe(true);

      // Node B cannot acquire while Node A holds it
      const wonB = await lockB.acquire();
      expect(wonB).toBe(false);
      expect(lockB.isLeader()).toBe(false);

      // Node A renews successfully
      const renewedA = await lockA.renew();
      expect(renewedA).toBe(true);

      // Node A releases lock
      await lockA.release();
      expect(lockA.isLeader()).toBe(false);
      expect(lostA).toBe(true);

      // Now Node B can acquire
      const wonB2 = await lockB.acquire();
      expect(wonB2).toBe(true);
      expect(lockB.isLeader()).toBe(true);

      await lockB.release();
    });
  });

  describe('PollerService', () => {
    let poller: PollerService;
    const matchId = 'match-101';
    const userId1 = 'user-1';
    const handle1 = 'coder_alpha';

    beforeAll(() => {
      poller = new PollerService(cfClient, config, logger);
    });

    afterAll(() => {
      poller.stop();
    });

    it('skips polling cycle when registry is empty', async () => {
      poller.stop();
      fakeCf.reset();
      expect(poller.getRegistry().size).toBe(0);

      // Cycle should run without calling fakeCf recentStatus
      await poller.cycle();
      expect(fakeCf['submissions']).toHaveLength(0);
    });

    it('detects a new OK submission within 1 cycle and dispatches verdict', async () => {
      const startTime = Date.now();
      const baselineId = 1000n;

      poller.register({
        matchId,
        questionIdx: 0,
        userId: userId1,
        handleNorm: handle1,
        contestId: 4,
        index: 'A',
        baselineId,
        startedAtMs: startTime,
        deadlineAtMs: startTime + 600_000,
      });

      fakeCf.seedUser({ handle: handle1 });

      const sub1: CfSubmission = {
        id: 1005n,
        creationTimeSeconds: Math.floor(startTime / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
        passedTestCount: 15,
        timeConsumedMillis: 30,
        memoryConsumedBytes: 1024,
      };
      fakeCf.addSubmission(sub1);

      const verdicts: PollerVerdictEvent[] = [];
      const removeListener = poller.addListener({
        onVerdict: (event) => {
          verdicts.push(event);
        },
      });

      // Enable poller
      await poller.start();
      await poller.cycle();

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]).toMatchObject({
        matchId,
        questionIdx: 0,
        userId: userId1,
        handleNorm: handle1.toLowerCase(),
        submissionId: 1005n,
        contestId: 4,
        index: 'A',
        verdict: 'OK',
        passedTestCount: 15,
      });

      // Subsequent cycle does not re-emit the same verdict
      await poller.cycle();
      expect(verdicts).toHaveLength(1);

      removeListener();
    });

    it('tracks TESTING submission as pending, then resolves to WRONG_ANSWER', async () => {
      const startTime = Date.now();
      const pendings: PollerPendingEvent[] = [];
      const verdicts: PollerVerdictEvent[] = [];

      const removeListener = poller.addListener({
        onPending: (event) => {
          pendings.push(event);
        },
        onVerdict: (event) => {
          verdicts.push(event);
        },
      });

      const subTesting: CfSubmission = {
        id: 1010n,
        creationTimeSeconds: Math.floor(startTime / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'TESTING',
      };
      fakeCf.addSubmission(subTesting);

      await poller.cycle();

      expect(pendings).toHaveLength(1);
      expect(pendings[0]!.submissionId).toBe(1010n);
      expect(verdicts).toHaveLength(0);

      // Verify active question registry has submission in pending map
      const entry = poller.getActive(handle1);
      expect(entry?.pending.has(1010n)).toBe(true);

      // Codeforces completes evaluation -> WRONG_ANSWER
      fakeCf.setVerdict(1010n, 'WRONG_ANSWER');

      // Recheck pending
      await poller.checkPendingSubmissions();

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0]!.submissionId).toBe(1010n);
      expect(verdicts[0]!.verdict).toBe('WRONG_ANSWER');
      expect(entry?.pending.has(1010n)).toBe(false);

      removeListener();
    });

    it('triggers gap recovery when recentStatus drops IDs', async () => {
      // Simulate high traffic jump:
      // Current maxSeenSubmissionId is e.g. 1010n.
      poller.setMaxSeenSubmissionId(1010n);

      const verdicts: PollerVerdictEvent[] = [];
      const removeListener = poller.addListener({
        onVerdict: (event) => {
          verdicts.push(event);
        },
      });

      // User submitted 1020n on problem 4A
      const missedSub: CfSubmission = {
        id: 1020n,
        creationTimeSeconds: Math.floor(Date.now() / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      fakeCf.addSubmission(missedSub);

      // Configure fake server to truncate recentStatus to top 1 (only newerSub with id 2000n)
      fakeCf.setRecentStatusTruncation(1);

      // Add a dummy newer submission to trigger oldestId > maxSeen
      const newerSub: CfSubmission = {
        id: 2000n,
        creationTimeSeconds: Math.floor(Date.now() / 1000),
        problem: { contestId: 999, index: 'Z', name: 'Other', tags: [] },
        author: { members: [{ handle: 'other_user' }] },
        verdict: 'OK',
      };
      fakeCf.addSubmission(newerSub);

      // Poller cycle detects gap (oldest in batch 2000n > maxSeen 1010n) and invokes user.status fallback
      await poller.cycle();

      // The missed submission 1020n was recovered via user.status!
      expect(verdicts.some((v) => v.submissionId === 1020n)).toBe(true);

      fakeCf.setRecentStatusTruncation(null);
      removeListener();
    });

    it('applies strict eligibility filtering (baseline, clock slack, deadline, problem)', async () => {
      const now = Date.now();
      const entry = poller.getActive(handle1)!;

      const verdicts: PollerVerdictEvent[] = [];
      const removeListener = poller.addListener({
        onVerdict: (event) => {
          verdicts.push(event);
        },
      });

      // 1. Submission <= baselineId (1000n)
      const oldSub: CfSubmission = {
        id: 999n,
        creationTimeSeconds: Math.floor(now / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      expect(await poller.processSubmission(oldSub)).toBe(false);

      // 2. Submission on wrong problem
      const wrongProblem: CfSubmission = {
        id: 3001n,
        creationTimeSeconds: Math.floor(now / 1000),
        problem: { contestId: 4, index: 'B', name: 'Wrong', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      expect(await poller.processSubmission(wrongProblem)).toBe(false);

      // 3. Submission created before question started (-3s slack)
      const tooEarly: CfSubmission = {
        id: 3002n,
        creationTimeSeconds: Math.floor((entry.startedAtMs - 10_000) / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      expect(await poller.processSubmission(tooEarly)).toBe(false);

      // 4. Submission within -3s clock slack (e.g. 2s before startedAtMs) -> ACCEPTED
      const withinSlack: CfSubmission = {
        id: 3003n,
        creationTimeSeconds: Math.floor((entry.startedAtMs - 2000) / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      expect(await poller.processSubmission(withinSlack)).toBe(true);

      // 5. Submission submitted after question deadline
      const afterDeadline: CfSubmission = {
        id: 3004n,
        creationTimeSeconds: Math.floor((entry.deadlineAtMs + 5000) / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      expect(await poller.processSubmission(afterDeadline)).toBe(false);

      removeListener();
    });

    it('enforces player hint 5s cooldown and processes high-priority check', async () => {
      const hintSub: CfSubmission = {
        id: 4001n,
        creationTimeSeconds: Math.floor(Date.now() / 1000),
        problem: { contestId: 4, index: 'A', name: 'Watermelon', tags: [] },
        author: { members: [{ handle: handle1 }] },
        verdict: 'OK',
      };
      fakeCf.addSubmission(hintSub);

      const verdicts: PollerVerdictEvent[] = [];
      const removeListener = poller.addListener({
        onVerdict: (event) => {
          verdicts.push(event);
        },
      });

      // First hint succeeds
      const firstHint = await poller.hint(userId1, handle1);
      expect(firstHint).toBe(true);
      expect(verdicts.some((v) => v.submissionId === 4001n)).toBe(true);

      // Second immediate hint is rate-limited by 5s cooldown
      const secondHint = await poller.hint(userId1, handle1);
      expect(secondHint).toBe(false);

      removeListener();
    });

    it('unregisters match questions cleanly', () => {
      expect(poller.getActive(handle1)).toBeDefined();
      const unregistered = poller.unregisterMatch(matchId);
      expect(unregistered).toBe(1);
      expect(poller.getActive(handle1)).toBeUndefined();
    });
  });
});
