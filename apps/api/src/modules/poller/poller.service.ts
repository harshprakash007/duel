import type { CfClient, CfSubmission } from '@duel/cf-client';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import type { Metrics } from '../../lib/metrics';
import {
  isFinalVerdict,
  type ActiveMatchQuestion,
  type PollerListener,
  type PollerPendingEvent,
  type PollerVerdictEvent,
} from './poller.types';

export class PollerService {
  private readonly registry = new Map<string, ActiveMatchQuestion>();
  private readonly userHintCooldowns = new Map<string, number>();
  private readonly listeners = new Set<PollerListener>();

  private maxSeenSubmissionId: bigint | null = null;
  private isRunning = false;
  private isCycleBusy = false;
  private isPendingBusy = false;
  private cycleTimer?: NodeJS.Timeout;
  private pendingTimer?: NodeJS.Timeout;

  constructor(
    private readonly cfClient: CfClient,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly metrics?: Metrics,
  ) {}

  public register(
    entry: Omit<ActiveMatchQuestion, 'pending' | 'processedSubmissions'> & {
      pending?: Map<bigint, { firstSeenAtMs: number; lastCheckedAtMs: number }>;
      processedSubmissions?: Set<bigint>;
    },
  ): void {
    const handleNorm = entry.handleNorm.toLowerCase();
    this.registry.set(handleNorm, {
      ...entry,
      handleNorm,
      index: entry.index.toUpperCase(),
      pending: entry.pending ?? new Map(),
      processedSubmissions: entry.processedSubmissions ?? new Set(),
    });

    this.logger.debug(
      {
        handleNorm,
        matchId: entry.matchId,
        questionIdx: entry.questionIdx,
        contestId: entry.contestId,
        index: entry.index,
        baselineId: entry.baselineId.toString(),
      },
      'Registered active match question in poller',
    );
  }

  public unregister(handleNorm: string): boolean {
    const removed = this.registry.delete(handleNorm.toLowerCase());
    if (removed) {
      this.logger.debug({ handleNorm }, 'Unregistered active handle from poller');
    }
    return removed;
  }

  public unregisterMatch(matchId: string): number {
    let count = 0;
    for (const [handleNorm, entry] of this.registry.entries()) {
      if (entry.matchId === matchId) {
        this.registry.delete(handleNorm);
        count++;
      }
    }
    if (count > 0) {
      this.logger.debug({ matchId, count }, 'Unregistered match entries from poller');
    }
    return count;
  }

  public getActive(handleNorm: string): ActiveMatchQuestion | undefined {
    return this.registry.get(handleNorm.toLowerCase());
  }

  public getRegistry(): Map<string, ActiveMatchQuestion> {
    return this.registry;
  }

  public updateDeadline(matchId: string, deadlineAtMs: number): void {
    for (const entry of this.registry.values()) {
      if (entry.matchId === matchId) {
        entry.deadlineAtMs = deadlineAtMs;
      }
    }
  }

  public getMaxSeenSubmissionId(): bigint | null {
    return this.maxSeenSubmissionId;
  }

  public setMaxSeenSubmissionId(id: bigint): void {
    this.maxSeenSubmissionId = id;
  }

  public addListener(listener: PollerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('Starting submission poller service');

    // Seed global maxSeenSubmissionId if null
    if (this.maxSeenSubmissionId === null) {
      try {
        const recent = await this.cfClient.recentStatus(10, 'low');
        if (recent.length > 0) {
          let maxId = recent[0]!.id;
          for (const s of recent) {
            if (s.id > maxId) maxId = s.id;
          }
          this.maxSeenSubmissionId = maxId;
          this.logger.info(
            { maxSeenSubmissionId: maxId.toString() },
            'Seeded initial maxSeenSubmissionId',
          );
        }
      } catch (err) {
        this.logger.warn({ err }, 'Could not seed initial maxSeenSubmissionId from CF');
      }
    }

    this.cycleTimer = setInterval(() => {
      void this.cycle();
    }, this.config.poller.intervalMs);

    this.pendingTimer = setInterval(() => {
      void this.checkPendingSubmissions();
    }, this.config.poller.pendingRecheckMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = undefined;
    }
    if (this.pendingTimer) {
      clearInterval(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    this.logger.info('Stopped submission poller service');
  }

  public async cycle(): Promise<void> {
    if (!this.isRunning || this.isCycleBusy || this.registry.size === 0) {
      return;
    }

    this.isCycleBusy = true;
    const cycleStart = Date.now();

    try {
      const subs = await this.cfClient.recentStatus(this.config.poller.recentCount, 'normal');
      if (subs.length === 0) return;

      let newestId = subs[0]!.id;
      let oldestId = subs[0]!.id;

      for (const s of subs) {
        if (s.id > newestId) newestId = s.id;
        if (s.id < oldestId) oldestId = s.id;
      }

      // Gap Check: if the oldest submission in this batch is strictly newer than our previous max seen,
      // a gap occurred (e.g. Codeforces high-traffic burst exceeded recentCount within cycle interval).
      if (this.maxSeenSubmissionId !== null && oldestId > this.maxSeenSubmissionId) {
        this.logger.warn(
          {
            oldestIdInBatch: oldestId.toString(),
            prevMaxSeen: this.maxSeenSubmissionId.toString(),
          },
          'Detected gap in recentStatus window; executing user.status fallback for active handles',
        );
        await this.runGapCheckForAllHandles();
      }

      // Advance global maxSeenSubmissionId
      if (this.maxSeenSubmissionId === null || newestId > this.maxSeenSubmissionId) {
        this.maxSeenSubmissionId = newestId;
      }

      // Process all submissions in batch
      for (const s of subs) {
        await this.processSubmission(s);
      }
    } catch (err) {
      this.logger.error({ err, durationMs: Date.now() - cycleStart }, 'Poller cycle failed');
    } finally {
      this.isCycleBusy = false;
      if (this.metrics) {
        this.metrics.pollerCycleSeconds.observe((Date.now() - cycleStart) / 1000);
      }
    }
  }

  public async checkPendingSubmissions(): Promise<void> {
    if (!this.isRunning || this.isPendingBusy || this.registry.size === 0) {
      return;
    }

    const handlesWithPending: string[] = [];
    for (const [handleNorm, entry] of this.registry.entries()) {
      if (entry.pending.size > 0) {
        handlesWithPending.push(handleNorm);
      }
    }

    if (handlesWithPending.length === 0) return;

    this.isPendingBusy = true;
    try {
      for (const handle of handlesWithPending) {
        if (!this.registry.has(handle)) continue;

        try {
          const subs = await this.cfClient.userStatus(handle, 1, 5, 'normal');
          for (const s of subs) {
            await this.processSubmission(s);
          }
        } catch (err) {
          this.logger.debug({ handle, err }, 'Failed to recheck pending submissions for handle');
        }
      }
    } finally {
      this.isPendingBusy = false;
    }
  }

  public async hint(userId: string, handle: string): Promise<boolean> {
    const now = Date.now();
    const lastHint = this.userHintCooldowns.get(userId) ?? 0;
    if (now - lastHint < this.config.poller.hintCooldownMs) {
      this.logger.debug({ userId, handle }, 'Player submission hint ignored due to cooldown');
      return false;
    }

    this.userHintCooldowns.set(userId, now);

    const handleNorm = handle.toLowerCase();
    const entry = this.registry.get(handleNorm);
    if (!entry) {
      this.logger.debug(
        { userId, handle },
        'Player submission hint ignored: not in active registry',
      );
      return false;
    }

    this.logger.info(
      { userId, handle },
      'Received player submission hint; triggering high-priority check',
    );

    try {
      const subs = await this.cfClient.userStatus(
        handle,
        1,
        this.config.poller.hintStatusCount,
        'high',
      );

      for (const s of subs) {
        await this.processSubmission(s);
      }
      return true;
    } catch (err) {
      this.logger.warn({ userId, handle, err }, 'Player submission hint check failed');
      return false;
    }
  }

  public async processSubmission(sub: CfSubmission): Promise<boolean> {
    if (!sub.author.members || sub.author.members.length === 0) {
      return false;
    }

    // Match any member handle to an active registry entry
    let matchedEntry: ActiveMatchQuestion | undefined;
    for (const m of sub.author.members) {
      const entry = this.registry.get(m.handle.toLowerCase());
      if (entry) {
        matchedEntry = entry;
        break;
      }
    }

    if (!matchedEntry) return false;

    // 1. Verify problem contestId and index match active question
    if (
      sub.problem.contestId === undefined ||
      sub.problem.contestId !== matchedEntry.contestId ||
      sub.problem.index.toUpperCase() !== matchedEntry.index
    ) {
      return false;
    }

    // 2. Verify submission is strictly newer than baseline ID
    if (sub.id <= matchedEntry.baselineId) {
      return false;
    }

    // 3. Verify creation time is within question start window (with startSlackMs buffer for clock skew)
    const creationMs = sub.creationTimeSeconds * 1000;
    if (creationMs < matchedEntry.startedAtMs - this.config.poller.startSlackMs) {
      return false;
    }

    // 4. Verify submission was submitted before or at question deadline
    if (creationMs > matchedEntry.deadlineAtMs) {
      return false;
    }

    // 5. Check if this submission has already been fully processed
    if (matchedEntry.processedSubmissions.has(sub.id)) {
      return false;
    }

    const isFinal = isFinalVerdict(sub.verdict);

    if (isFinal) {
      matchedEntry.pending.delete(sub.id);
      matchedEntry.processedSubmissions.add(sub.id);

      if (this.metrics && sub.creationTimeSeconds > 0) {
        const lagSec = Math.max(0, Date.now() / 1000 - sub.creationTimeSeconds);
        this.metrics.pollerDetectionLagSeconds.observe(lagSec);
      }

      const event: PollerVerdictEvent = {
        matchId: matchedEntry.matchId,
        questionIdx: matchedEntry.questionIdx,
        userId: matchedEntry.userId,
        handleNorm: matchedEntry.handleNorm,
        submissionId: sub.id,
        contestId: matchedEntry.contestId,
        index: matchedEntry.index,
        verdict: sub.verdict ?? 'UNKNOWN',
        passedTestCount: sub.passedTestCount ?? 0,
        timeConsumedMillis: sub.timeConsumedMillis ?? 0,
        memoryConsumedBytes: sub.memoryConsumedBytes ?? 0,
        creationTimeSeconds: sub.creationTimeSeconds,
        detectedAtMs: Date.now(),
      };

      this.logger.info(
        {
          matchId: event.matchId,
          handle: event.handleNorm,
          submissionId: event.submissionId.toString(),
          verdict: event.verdict,
          passedTestCount: event.passedTestCount,
        },
        'Detected final submission verdict',
      );

      await this.dispatchVerdict(event);
      return true;
    } else {
      // Non-final verdict (TESTING, SUBMITTED, etc.)
      const isNewPending = !matchedEntry.pending.has(sub.id);
      matchedEntry.pending.set(sub.id, {
        firstSeenAtMs: matchedEntry.pending.get(sub.id)?.firstSeenAtMs ?? Date.now(),
        lastCheckedAtMs: Date.now(),
      });

      if (isNewPending) {
        const event: PollerPendingEvent = {
          matchId: matchedEntry.matchId,
          questionIdx: matchedEntry.questionIdx,
          userId: matchedEntry.userId,
          handleNorm: matchedEntry.handleNorm,
          submissionId: sub.id,
          contestId: matchedEntry.contestId,
          index: matchedEntry.index,
          creationTimeSeconds: sub.creationTimeSeconds,
          detectedAtMs: Date.now(),
        };

        this.logger.debug(
          {
            matchId: event.matchId,
            handle: event.handleNorm,
            submissionId: event.submissionId.toString(),
          },
          'Detected pending submission',
        );

        await this.dispatchPending(event);
      }
      return true;
    }
  }

  private async runGapCheckForAllHandles(): Promise<void> {
    for (const handleNorm of this.registry.keys()) {
      try {
        const subs = await this.cfClient.userStatus(
          handleNorm,
          1,
          this.config.poller.gapStatusCount,
          'normal',
        );

        for (const s of subs) {
          await this.processSubmission(s);
        }
      } catch (err) {
        this.logger.warn({ handleNorm, err }, 'Gap check user.status fallback failed for handle');
      }
    }
  }

  private async dispatchVerdict(event: PollerVerdictEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener.onVerdict?.(event);
      } catch (err) {
        this.logger.error({ err, listener }, 'Error in poller onVerdict listener');
      }
    }
  }

  private async dispatchPending(event: PollerPendingEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener.onPending?.(event);
      } catch (err) {
        this.logger.error({ err, listener }, 'Error in poller onPending listener');
      }
    }
  }
}
