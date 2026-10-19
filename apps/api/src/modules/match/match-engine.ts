import type { Db } from '../../db/prisma';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import type { PollerService } from '../poller/poller.service';
import type { PickerService } from '../problems/picker.service';
import type { PollerVerdictEvent } from '../poller/poller.types';
import {
  calculateScore,
  getQuestionCapMs,
  isPenaltyVerdict,
  type MatchLifecycleMode,
  type MatchLifecycleStatus,
  type ProblemDto,
} from '@duel/shared';
import {
  toMatchStateSnapshot,
  type ActiveMatch,
  type InternalPlayerState,
  type InternalQuestionState,
  type MatchEngineEmitter,
} from './match-engine.types';
import type {
  MatchEndReason as DbMatchEndReason,
  MatchMode,
  MatchResult,
  MatchStatus,
} from '../../generated/prisma/client';

export function toProblemDto(p: {
  id: number;
  contestId: number;
  index: string;
  name: string;
  rating: number;
  tags: string[];
}): ProblemDto {
  return {
    id: p.id,
    contestId: p.contestId,
    index: p.index,
    name: p.name,
    rating: p.rating,
    tags: p.tags,
    url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
  };
}

export type MatchEndReason =
  'COMPLETED' | 'RESIGN' | 'ABORT_NO_SHOW' | 'ABORT_CF_OUTAGE' | 'ABORT_NO_PROBLEMS' | 'VOIDED';

export class MatchEngine {
  private readonly activeMatches = new Map<string, ActiveMatch>();
  private emitter?: MatchEngineEmitter;

  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly poller: PollerService,
    private readonly picker: PickerService,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  public setEmitter(emitter: MatchEngineEmitter): void {
    this.emitter = emitter;
  }

  public getActiveMatch(matchId: string): ActiveMatch | undefined {
    return this.activeMatches.get(matchId);
  }

  public async getActiveMatchForUser(userId: string): Promise<ActiveMatch | undefined> {
    try {
      const matchId = await this.redis.get(`match:user:${userId}`);
      if (!matchId) return undefined;
      return this.activeMatches.get(matchId);
    } catch {
      return undefined;
    }
  }

  /**
   * Enqueues an async task onto a per-match serial task queue to prevent race conditions.
   */
  private enqueue<T>(matchId: string, task: () => Promise<T>): Promise<T> {
    const match = this.activeMatches.get(matchId);
    if (!match) {
      return task();
    }
    const next = match.queue.then(task, task);
    match.queue = next.catch((err) => {
      this.logger.error({ err, matchId }, 'Error in match task queue');
    });
    return next;
  }

  private async saveSnapshot(match: ActiveMatch): Promise<void> {
    try {
      const snapshot = toMatchStateSnapshot(match);
      await this.redis.set(
        `match:snapshot:${match.matchId}`,
        JSON.stringify(snapshot),
        'EX',
        86400, // 24 hours
      );
    } catch (err) {
      this.logger.error({ err, matchId: match.matchId }, 'Failed to save match snapshot to Redis');
    }
  }

  /**
   * Creates and initializes a new match in DB and memory.
   */
  public async createMatch(data: {
    sheetId: string;
    mode: MatchLifecycleMode;
    players: Array<{
      userId: string;
      handle: string;
      handleNorm: string;
      rating: number;
    }>;
    questionCount?: number;
    roomCode?: string;
  }): Promise<ActiveMatch> {
    const sheet = await this.db.levelSheet.findUniqueOrThrow({
      where: { id: data.sheetId },
    });

    const questionCount = data.questionCount ?? sheet.questionCount;
    const isRanked = data.mode === 'RANKED';

    // Pick problems up-front
    const playerA = data.players[0]!;
    const playerB = data.players[1]!;
    const problems = await this.picker.pick(sheet, playerA.userId, playerB.userId, questionCount);

    // Create DB records in transaction
    const matchRecord = await this.db.$transaction(async (tx) => {
      const match = await tx.match.create({
        data: {
          sheetId: data.sheetId,
          mode: data.mode as MatchMode,
          status: isRanked ? 'COUNTDOWN' : 'LOBBY',
          questionCount,
          roomCode: data.roomCode,
          startedAt: isRanked ? new Date() : null,
        },
      });

      for (const p of data.players) {
        await tx.matchPlayer.create({
          data: {
            matchId: match.id,
            userId: p.userId,
            handleNorm: p.handleNorm,
            ratingBefore: p.rating,
          },
        });
      }

      for (let i = 0; i < problems.length; i++) {
        const prob = problems[i]!;
        await tx.matchQuestion.create({
          data: {
            matchId: match.id,
            idx: i,
            problemId: prob.id,
            status: 'PENDING',
          },
        });
      }

      return match;
    });

    // Build memory state
    const players: Record<string, InternalPlayerState> = {};
    for (const p of data.players) {
      players[p.userId] = {
        userId: p.userId,
        handle: p.handle,
        handleNorm: p.handleNorm,
        rating: p.rating,
        score: 0,
        solvedCurrent: false,
        solveTimeMs: null,
        wrongAttemptsCurrent: 0,
        connected: false,
        ready: isRanked, // Ranked players are ready upon match creation
      };
    }

    const questions: InternalQuestionState[] = problems.map((prob, i) => ({
      idx: i,
      problemId: prob.id,
      problem: toProblemDto(prob),
      capMs: getQuestionCapMs(prob.rating, this.config.match.questionCaps),
      scores: {},
    }));

    const activeMatch: ActiveMatch = {
      matchId: matchRecord.id,
      status: isRanked ? 'COUNTDOWN' : 'LOBBY',
      mode: data.mode,
      sheetId: data.sheetId,
      questionCount,
      currentQuestionIdx: 0,
      paused: false,
      pausedTotalMs: 0,
      players,
      questions,
      queue: Promise.resolve(),
    };

    this.activeMatches.set(activeMatch.matchId, activeMatch);

    // Register active user keys in Redis (TTL 24 hours)
    for (const p of data.players) {
      await this.redis.set(`match:user:${p.userId}`, activeMatch.matchId, 'EX', 86400);
    }

    await this.saveSnapshot(activeMatch);

    if (isRanked) {
      await this.doStartCountdown(activeMatch.matchId);
    } else {
      activeMatch.preStartTimer = setTimeout(() => {
        void this.finishMatch(activeMatch.matchId, 'ABORT_NO_SHOW');
      }, this.config.match.preStartAbsenceMs);
      this.emitter?.emitToMatch(
        activeMatch.matchId,
        'match:state',
        toMatchStateSnapshot(activeMatch),
      );
    }

    return activeMatch;
  }

  public async playerReady(matchId: string, userId: string): Promise<boolean> {
    return this.enqueue(matchId, () => this.doPlayerReady(matchId, userId));
  }

  private async doPlayerReady(matchId: string, userId: string): Promise<boolean> {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status !== 'LOBBY') return false;
    const player = match.players[userId];
    if (!player) return false;

    player.ready = true;
    const allReady =
      Object.values(match.players).length === 2 &&
      Object.values(match.players).every((p) => p.ready);

    if (allReady) {
      if (match.preStartTimer) {
        clearTimeout(match.preStartTimer);
        match.preStartTimer = undefined;
      }
      await this.doStartCountdown(matchId);
    } else {
      await this.saveSnapshot(match);
      this.emitter?.emitToMatch(matchId, 'match:state', toMatchStateSnapshot(match));
    }

    return true;
  }

  public async startCountdown(matchId: string): Promise<void> {
    return this.enqueue(matchId, () => this.doStartCountdown(matchId));
  }

  private async doStartCountdown(matchId: string): Promise<void> {
    const match = this.activeMatches.get(matchId);
    if (!match || (match.status !== 'LOBBY' && match.status !== 'COUNTDOWN')) return;

    match.status = 'COUNTDOWN';
    match.countdownDeadlineMs = Date.now() + this.config.match.countdownMs;

    await this.db.match.update({
      where: { id: matchId },
      data: {
        status: 'COUNTDOWN',
        startedAt: new Date(),
      },
    });

    await this.saveSnapshot(match);
    this.emitter?.emitToMatch(matchId, 'match:state', toMatchStateSnapshot(match));

    match.timer = setTimeout(() => {
      void this.startQuestion(matchId, 0);
    }, this.config.match.countdownMs);
  }

  public async startQuestion(matchId: string, idx: number): Promise<void> {
    return this.enqueue(matchId, () => this.doStartQuestion(matchId, idx));
  }

  private async doStartQuestion(matchId: string, idx: number): Promise<void> {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status === 'FINISHED' || match.status === 'ABORTED') return;

    if (match.timer) {
      clearTimeout(match.timer);
      match.timer = undefined;
    }

    match.status = 'ACTIVE';
    match.currentQuestionIdx = idx;
    match.countdownDeadlineMs = undefined;
    match.breakDeadlineMs = undefined;

    // Reset question-specific player states
    for (const p of Object.values(match.players)) {
      p.solvedCurrent = false;
      p.solveTimeMs = null;
      p.wrongAttemptsCurrent = 0;
      p.solveSubmissionId = undefined;
      p.solveCreationTimeSeconds = undefined;
    }

    const q = match.questions[idx];
    if (!q) {
      await this.doFinishMatch(matchId, 'COMPLETED');
      return;
    }

    const capMs = getQuestionCapMs(q.problem.rating, this.config.match.questionCaps);
    q.capMs = capMs;

    const now = Date.now();
    q.startedAtMs = now;
    q.deadlineAtMs = now + capMs;

    const baselineId = this.poller.getMaxSeenSubmissionId() ?? 0n;

    // Update DB
    await this.db.$transaction([
      this.db.match.update({
        where: { id: matchId },
        data: { status: 'ACTIVE' },
      }),
      this.db.matchQuestion.update({
        where: {
          matchId_idx: {
            matchId,
            idx,
          },
        },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(q.startedAtMs),
          deadlineAt: new Date(q.deadlineAtMs),
          baselineSubmissionId: baselineId,
        },
      }),
    ]);

    // Register players in submission poller
    for (const p of Object.values(match.players)) {
      this.poller.register({
        matchId,
        questionIdx: idx,
        userId: p.userId,
        handleNorm: p.handleNorm,
        contestId: q.problem.contestId,
        index: q.problem.index,
        baselineId,
        startedAtMs: q.startedAtMs,
        deadlineAtMs: q.deadlineAtMs,
      });
    }

    // Arm deadline timer
    match.timer = setTimeout(() => {
      void this.endQuestion(matchId, idx);
    }, capMs);

    await this.saveSnapshot(match);

    this.emitter?.emitToMatch(matchId, 'question:start', {
      idx,
      problem: q.problem,
      startedAtMs: q.startedAtMs,
      deadlineAtMs: q.deadlineAtMs,
      serverNow: Date.now(),
    });
    this.emitter?.emitToMatch(matchId, 'match:state', toMatchStateSnapshot(match));
  }

  public async handleVerdict(event: PollerVerdictEvent): Promise<void> {
    const match = this.activeMatches.get(event.matchId);
    if (!match) return;

    return this.enqueue(event.matchId, () => this.doHandleVerdict(event));
  }

  private async doHandleVerdict(event: PollerVerdictEvent): Promise<void> {
    const match = this.activeMatches.get(event.matchId);
    if (!match) return;

    if (match.status !== 'ACTIVE' || match.currentQuestionIdx !== event.questionIdx) {
      return;
    }

    const player = match.players[event.userId];
    if (!player || player.solvedCurrent) {
      return;
    }

    const currentQ = match.questions[match.currentQuestionIdx];
    if (!currentQ) return;

    // Persist submission record in DB
    try {
      const questionRecord = await this.db.matchQuestion.findUnique({
        where: { matchId_idx: { matchId: match.matchId, idx: match.currentQuestionIdx } },
        select: { id: true },
      });

      if (questionRecord) {
        await this.db.submission.upsert({
          where: { id: event.submissionId },
          create: {
            id: event.submissionId,
            matchQuestionId: questionRecord.id,
            userId: event.userId,
            verdict: event.verdict,
            creationTimeSec: event.creationTimeSeconds,
            finalAt: new Date(),
          },
          update: {
            verdict: event.verdict,
            finalAt: new Date(),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        { err, submissionId: event.submissionId.toString() },
        'Failed to persist submission',
      );
    }

    if (isPenaltyVerdict(event.verdict)) {
      player.wrongAttemptsCurrent += 1;
      await this.saveSnapshot(match);
      this.emitter?.emitToMatch(match.matchId, 'question:update', {
        userId: event.userId,
        solved: false,
        wrongAttempts: player.wrongAttemptsCurrent,
        serverNow: Date.now(),
      });
      this.emitter?.emitToMatch(match.matchId, 'match:state', toMatchStateSnapshot(match));
      return;
    }

    if (event.verdict.toUpperCase() === 'OK') {
      player.solvedCurrent = true;
      player.solveSubmissionId = event.submissionId;
      player.solveCreationTimeSeconds = event.creationTimeSeconds;

      const rawSolveTime = event.creationTimeSeconds * 1000 - (currentQ.startedAtMs ?? Date.now());
      player.solveTimeMs = Math.max(0, Math.min(currentQ.capMs, rawSolveTime));

      // Post-First-Solve Rule: if first solve, shrink deadline to min(deadline, now + 180s)
      const otherSolved = Object.values(match.players).some(
        (p) => p.userId !== player.userId && p.solvedCurrent,
      );

      if (!otherSolved && currentQ.deadlineAtMs !== undefined) {
        const shrunk = Math.min(
          currentQ.deadlineAtMs,
          Date.now() + this.config.match.postFirstSolveMs,
        );
        if (shrunk < currentQ.deadlineAtMs) {
          currentQ.deadlineAtMs = shrunk;
          // Update deadline in DB
          await this.db.matchQuestion.update({
            where: {
              matchId_idx: {
                matchId: match.matchId,
                idx: match.currentQuestionIdx,
              },
            },
            data: {
              deadlineAt: new Date(shrunk),
            },
          });

          // Update deadline in poller registry
          this.poller.updateDeadline(match.matchId, shrunk);

          // Re-arm timer
          if (match.timer) {
            clearTimeout(match.timer);
          }
          const remaining = Math.max(0, shrunk - Date.now());
          match.timer = setTimeout(() => {
            void this.endQuestion(match.matchId, match.currentQuestionIdx);
          }, remaining);
        }
      }

      this.emitter?.emitToMatch(match.matchId, 'question:update', {
        userId: event.userId,
        solved: true,
        wrongAttempts: player.wrongAttemptsCurrent,
        serverNow: Date.now(),
      });
      this.emitter?.emitToMatch(match.matchId, 'match:state', toMatchStateSnapshot(match));
      await this.saveSnapshot(match);

      // If both players have solved, finish question immediately
      const allSolved = Object.values(match.players).every((p) => p.solvedCurrent);
      if (allSolved) {
        if (match.timer) {
          clearTimeout(match.timer);
          match.timer = undefined;
        }
        await this.doEndQuestion(match.matchId, match.currentQuestionIdx);
      }
    }
  }

  public async endQuestion(matchId: string, idx: number): Promise<void> {
    return this.enqueue(matchId, () => this.doEndQuestion(matchId, idx));
  }

  private async doEndQuestion(matchId: string, idx: number): Promise<void> {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status !== 'ACTIVE') return;

    const currentQ = match.questions[idx];
    if (!currentQ || currentQ.endedAtMs !== undefined) return;

    if (match.timer) {
      clearTimeout(match.timer);
      match.timer = undefined;
    }

    // Unregister from poller
    this.poller.unregisterMatch(matchId);

    currentQ.endedAtMs = Date.now();

    // Resolve first solve: earliest creationTimeSeconds, tie-break lowest submissionId
    const solvers = Object.values(match.players).filter(
      (p) => p.solvedCurrent && p.solveSubmissionId !== undefined,
    );

    if (solvers.length > 0) {
      solvers.sort((a, b) => {
        const timeA = a.solveCreationTimeSeconds ?? 0;
        const timeB = b.solveCreationTimeSeconds ?? 0;
        if (timeA !== timeB) return timeA - timeB;
        const idA = a.solveSubmissionId ?? 0n;
        const idB = b.solveSubmissionId ?? 0n;
        return idA < idB ? -1 : 1;
      });
      currentQ.firstSolveUserId = solvers[0]!.userId;
    }

    // Calculate score for each player
    for (const p of Object.values(match.players)) {
      const pts = calculateScore(
        currentQ.capMs,
        p.solvedCurrent ? p.solveTimeMs : null,
        p.wrongAttemptsCurrent,
        p.userId === currentQ.firstSolveUserId,
        this.config.scoring,
      );
      currentQ.scores[p.userId] = pts;
      p.score += pts;
    }

    // Persist question completion and results in DB
    const questionRecord = await this.db.matchQuestion.update({
      where: {
        matchId_idx: {
          matchId,
          idx,
        },
      },
      data: {
        status: 'ENDED',
        endedAt: new Date(currentQ.endedAtMs),
      },
    });

    for (const p of Object.values(match.players)) {
      await this.db.questionResult.upsert({
        where: {
          matchQuestionId_userId: {
            matchQuestionId: questionRecord.id,
            userId: p.userId,
          },
        },
        create: {
          matchQuestionId: questionRecord.id,
          userId: p.userId,
          solvedAtMs:
            p.solvedCurrent && p.solveCreationTimeSeconds
              ? BigInt(p.solveCreationTimeSeconds * 1000)
              : null,
          timeToSolveMs: p.solvedCurrent ? p.solveTimeMs : null,
          wrongAttempts: p.wrongAttemptsCurrent,
          points: currentQ.scores[p.userId] ?? 0,
          firstSolve: p.userId === currentQ.firstSolveUserId,
        },
        update: {
          solvedAtMs:
            p.solvedCurrent && p.solveCreationTimeSeconds
              ? BigInt(p.solveCreationTimeSeconds * 1000)
              : null,
          timeToSolveMs: p.solvedCurrent ? p.solveTimeMs : null,
          wrongAttempts: p.wrongAttemptsCurrent,
          points: currentQ.scores[p.userId] ?? 0,
          firstSolve: p.userId === currentQ.firstSolveUserId,
        },
      });
    }

    const nextIdx = idx + 1;
    if (nextIdx < match.questionCount) {
      match.breakDeadlineMs = Date.now() + this.config.match.breakMs;

      await this.saveSnapshot(match);

      this.emitter?.emitToMatch(matchId, 'question:end', {
        idx,
        scores: { ...currentQ.scores },
        firstSolveUserId: currentQ.firstSolveUserId,
        breakDeadlineMs: match.breakDeadlineMs,
        serverNow: Date.now(),
      });
      this.emitter?.emitToMatch(matchId, 'match:state', toMatchStateSnapshot(match));

      match.timer = setTimeout(() => {
        void this.startQuestion(matchId, nextIdx);
      }, this.config.match.breakMs);
    } else {
      this.emitter?.emitToMatch(matchId, 'question:end', {
        idx,
        scores: { ...currentQ.scores },
        firstSolveUserId: currentQ.firstSolveUserId,
        breakDeadlineMs: Date.now(),
        serverNow: Date.now(),
      });
      await this.doFinishMatch(matchId, 'COMPLETED');
    }
  }

  public async finishMatch(matchId: string, endReason: MatchEndReason): Promise<void> {
    return this.enqueue(matchId, () => this.doFinishMatch(matchId, endReason));
  }

  private async doFinishMatch(matchId: string, endReason: MatchEndReason): Promise<void> {
    const match = this.activeMatches.get(matchId);
    if (!match || match.status === 'FINISHED' || match.status === 'ABORTED') return;

    if (match.timer) {
      clearTimeout(match.timer);
      match.timer = undefined;
    }
    if (match.outageAbortTimer) {
      clearTimeout(match.outageAbortTimer);
      match.outageAbortTimer = undefined;
    }
    if (match.preStartTimer) {
      clearTimeout(match.preStartTimer);
      match.preStartTimer = undefined;
    }

    this.poller.unregisterMatch(matchId);

    const playersList = Object.values(match.players);
    let winnerUserId = match.winnerUserId;
    const playerResults: Record<string, 'WIN' | 'LOSS' | 'DRAW' | null> = {};

    if (endReason === 'RESIGN') {
      for (const p of playersList) {
        playerResults[p.userId] = p.userId === winnerUserId ? 'WIN' : 'LOSS';
      }
    } else if (endReason === 'COMPLETED') {
      const p0 = playersList[0]!;
      const p1 = playersList[1]!;
      if (p0.score > p1.score) {
        winnerUserId = p0.userId;
        playerResults[p0.userId] = 'WIN';
        playerResults[p1.userId] = 'LOSS';
      } else if (p1.score > p0.score) {
        winnerUserId = p1.userId;
        playerResults[p1.userId] = 'WIN';
        playerResults[p0.userId] = 'LOSS';
      } else {
        winnerUserId = undefined;
        playerResults[p0.userId] = 'DRAW';
        playerResults[p1.userId] = 'DRAW';
      }
    } else {
      // Aborted match
      winnerUserId = undefined;
      for (const p of playersList) {
        playerResults[p.userId] = null;
      }
    }

    const isAborted = endReason.startsWith('ABORT');
    match.status = isAborted ? 'ABORTED' : 'FINISHED';
    match.winnerUserId = winnerUserId;
    match.endReason = endReason;

    // Update DB in single transaction
    await this.db.$transaction(async (tx) => {
      for (const p of playersList) {
        await tx.matchPlayer.update({
          where: {
            matchId_userId: {
              matchId,
              userId: p.userId,
            },
          },
          data: {
            totalScore: p.score,
            result: playerResults[p.userId] as MatchResult | null,
          },
        });
      }

      await tx.match.update({
        where: { id: matchId },
        data: {
          status: match.status as MatchStatus,
          finishedAt: new Date(),
          winnerUserId: winnerUserId ?? null,
          endReason: endReason as DbMatchEndReason,
          pausedTotalMs: match.pausedTotalMs,
        },
      });
    });

    // Clear user active match pointers in Redis
    for (const p of playersList) {
      await this.redis.del(`match:user:${p.userId}`);
      const active = await this.redis.get(`active:${p.userId}`);
      if (active && active.startsWith('match:')) {
        await this.redis.del(`active:${p.userId}`);
      }
    }

    await this.saveSnapshot(match);

    const finalScores: Record<string, number> = {};
    for (const p of playersList) {
      finalScores[p.userId] = p.score;
    }

    this.emitter?.emitToMatch(matchId, 'match:end', {
      winnerUserId,
      scores: finalScores,
      endReason,
      serverNow: Date.now(),
    });
    this.emitter?.emitToMatch(matchId, 'match:state', toMatchStateSnapshot(match));
  }

  public async resign(matchId: string, resigningUserId: string): Promise<boolean> {
    return this.enqueue(matchId, () => this.doResign(matchId, resigningUserId));
  }

  private async doResign(matchId: string, resigningUserId: string): Promise<boolean> {
    const match = this.activeMatches.get(matchId);
    if (
      !match ||
      (match.status !== 'ACTIVE' && match.status !== 'COUNTDOWN' && match.status !== 'LOBBY')
    ) {
      return false;
    }

    const opponent = Object.values(match.players).find((p) => p.userId !== resigningUserId);
    match.winnerUserId = opponent ? opponent.userId : undefined;

    await this.doFinishMatch(matchId, 'RESIGN');
    return true;
  }

  public handleCfStateChange(isDegraded: boolean): void {
    const now = Date.now();

    if (isDegraded) {
      this.logger.warn('Codeforces degraded: pausing active match timers');
      for (const match of this.activeMatches.values()) {
        if (match.status === 'ACTIVE' && !match.paused) {
          match.paused = true;
          match.pausedAtMs = now;

          if (match.timer) {
            clearTimeout(match.timer);
            match.timer = undefined;
          }

          // Abort if outage exceeds cfOutageAbortMs (10 minutes)
          match.outageAbortTimer = setTimeout(() => {
            void this.finishMatch(match.matchId, 'ABORT_CF_OUTAGE');
          }, this.config.match.cfOutageAbortMs);

          void this.saveSnapshot(match);
          this.emitter?.emitToMatch(match.matchId, 'system:cf_degraded', { serverNow: now });
          this.emitter?.emitToMatch(match.matchId, 'match:state', toMatchStateSnapshot(match));
        }
      }
    } else {
      this.logger.info('Codeforces recovered: resuming active matches with extended deadlines');
      for (const match of this.activeMatches.values()) {
        if (match.paused && match.pausedAtMs) {
          const pausedDuration = now - match.pausedAtMs;
          match.pausedTotalMs += pausedDuration;
          match.paused = false;
          match.pausedAtMs = undefined;

          if (match.outageAbortTimer) {
            clearTimeout(match.outageAbortTimer);
            match.outageAbortTimer = undefined;
          }

          const currentQ = match.questions[match.currentQuestionIdx];
          if (match.status === 'ACTIVE' && currentQ && currentQ.deadlineAtMs !== undefined) {
            currentQ.deadlineAtMs += pausedDuration;
            this.poller.updateDeadline(match.matchId, currentQ.deadlineAtMs);

            const remaining = Math.max(0, currentQ.deadlineAtMs - now);
            match.timer = setTimeout(() => {
              void this.endQuestion(match.matchId, match.currentQuestionIdx);
            }, remaining);
          } else if (match.breakDeadlineMs !== undefined) {
            match.breakDeadlineMs += pausedDuration;
            const remaining = Math.max(0, match.breakDeadlineMs - now);
            match.timer = setTimeout(() => {
              void this.startQuestion(match.matchId, match.currentQuestionIdx + 1);
            }, remaining);
          }

          void this.saveSnapshot(match);
          this.emitter?.emitToMatch(match.matchId, 'system:cf_recovered', {
            serverNow: now,
            extendedMs: pausedDuration,
          });
          this.emitter?.emitToMatch(match.matchId, 'match:state', toMatchStateSnapshot(match));
        }
      }
    }
  }

  public async recoverActiveMatches(): Promise<void> {
    const activeRecords = await this.db.match.findMany({
      where: {
        status: { in: ['COUNTDOWN', 'ACTIVE'] },
      },
      include: {
        players: { include: { user: { include: { handle: true } } } },
        questions: { include: { problem: true } },
      },
    });

    if (activeRecords.length === 0) return;

    this.logger.info({ count: activeRecords.length }, 'Recovering active matches on boot');
    const now = Date.now();

    for (const record of activeRecords) {
      try {
        const players: Record<string, InternalPlayerState> = {};
        for (const p of record.players) {
          players[p.userId] = {
            userId: p.userId,
            handle: p.user.handle?.handle ?? p.handleNorm,
            handleNorm: p.handleNorm,
            rating: p.ratingBefore,
            score: p.totalScore,
            solvedCurrent: false,
            solveTimeMs: null,
            wrongAttemptsCurrent: 0,
            connected: false,
            ready: true,
          };
        }

        const questions: InternalQuestionState[] = record.questions
          .sort((a, b) => a.idx - b.idx)
          .map((q) => ({
            idx: q.idx,
            problemId: q.problemId,
            problem: toProblemDto(q.problem),
            capMs: getQuestionCapMs(q.problem.rating, this.config.match.questionCaps),
            startedAtMs: q.startedAt ? q.startedAt.getTime() : undefined,
            deadlineAtMs: q.deadlineAt ? q.deadlineAt.getTime() : undefined,
            endedAtMs: q.endedAt ? q.endedAt.getTime() : undefined,
            scores: {},
          }));

        let currentIdx = 0;
        for (let i = 0; i < questions.length; i++) {
          if (questions[i]!.endedAtMs === undefined) {
            currentIdx = i;
            break;
          }
        }

        const match: ActiveMatch = {
          matchId: record.id,
          status: record.status as MatchLifecycleStatus,
          mode: record.mode as MatchLifecycleMode,
          sheetId: record.sheetId,
          questionCount: record.questionCount,
          currentQuestionIdx: currentIdx,
          paused: false,
          pausedTotalMs: record.pausedTotalMs,
          players,
          questions,
          queue: Promise.resolve(),
        };

        this.activeMatches.set(match.matchId, match);

        for (const p of record.players) {
          await this.redis.set(`match:user:${p.userId}`, match.matchId, 'EX', 86400);
        }

        if (match.status === 'COUNTDOWN') {
          void this.startQuestion(match.matchId, 0);
        } else if (match.status === 'ACTIVE') {
          const currentQ = match.questions[currentIdx];
          if (currentQ && currentQ.deadlineAtMs !== undefined) {
            const remaining = currentQ.deadlineAtMs - now;
            if (remaining > 0) {
              for (const p of Object.values(match.players)) {
                this.poller.register({
                  matchId: match.matchId,
                  questionIdx: currentIdx,
                  userId: p.userId,
                  handleNorm: p.handleNorm,
                  contestId: currentQ.problem.contestId,
                  index: currentQ.problem.index,
                  baselineId: 0n,
                  startedAtMs: currentQ.startedAtMs ?? now,
                  deadlineAtMs: currentQ.deadlineAtMs,
                });
              }
              match.timer = setTimeout(() => {
                void this.endQuestion(match.matchId, currentIdx);
              }, remaining);
            } else {
              void this.endQuestion(match.matchId, currentIdx);
            }
          }
        }
      } catch (err) {
        this.logger.error({ err, matchId: record.id }, 'Failed to recover active match on boot');
      }
    }
  }

  public destroy(): void {
    for (const match of this.activeMatches.values()) {
      if (match.timer) clearTimeout(match.timer);
      if (match.outageAbortTimer) clearTimeout(match.outageAbortTimer);
      if (match.preStartTimer) clearTimeout(match.preStartTimer);
      this.poller.unregisterMatch(match.matchId);
    }
    this.activeMatches.clear();
  }
}
