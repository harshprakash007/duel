import type {
  MatchLifecycleMode,
  MatchLifecycleStatus,
  MatchStateSnapshot,
  PlayerStateSnapshot,
  ProblemDto,
  QuestionResultDto,
} from '@duel/shared';

export interface InternalPlayerState {
  userId: string;
  handle: string;
  handleNorm: string;
  rating: number;
  score: number;
  solvedCurrent: boolean;
  solveTimeMs: number | null;
  wrongAttemptsCurrent: number;
  connected: boolean;
  ready: boolean;
  solveSubmissionId?: bigint;
  solveCreationTimeSeconds?: number;
}

export interface InternalQuestionState {
  idx: number;
  problemId: number;
  problem: ProblemDto;
  capMs: number;
  startedAtMs?: number;
  deadlineAtMs?: number;
  endedAtMs?: number;
  scores: Record<string, number>;
  firstSolveUserId?: string;
}

export interface ActiveMatch {
  matchId: string;
  status: MatchLifecycleStatus;
  mode: MatchLifecycleMode;
  sheetId: string;
  questionCount: number;
  currentQuestionIdx: number;
  countdownDeadlineMs?: number;
  breakDeadlineMs?: number;
  paused: boolean;
  pausedAtMs?: number;
  pausedTotalMs: number;
  winnerUserId?: string;
  endReason?: string;
  players: Record<string, InternalPlayerState>;
  questions: InternalQuestionState[];
  timer?: NodeJS.Timeout;
  outageAbortTimer?: NodeJS.Timeout;
  preStartTimer?: NodeJS.Timeout;
  queue: Promise<unknown>;
}

export interface MatchEngineEmitter {
  emitToMatch: (matchId: string, event: string, data: unknown) => void;
  emitToUser: (userId: string, event: string, data: unknown) => void;
}

export function toMatchStateSnapshot(
  match: ActiveMatch,
  serverNow = Date.now(),
): MatchStateSnapshot {
  const players: Record<string, PlayerStateSnapshot> = {};
  for (const [userId, p] of Object.entries(match.players)) {
    players[userId] = {
      userId: p.userId,
      handle: p.handle,
      rating: p.rating,
      score: p.score,
      solvedCurrent: p.solvedCurrent,
      wrongAttemptsCurrent: p.wrongAttemptsCurrent,
      connected: p.connected,
    };
  }

  const currentQ = match.questions[match.currentQuestionIdx];

  const questionResults: QuestionResultDto[] = [];
  for (let i = 0; i < match.questions.length; i++) {
    const q = match.questions[i]!;
    if (q.endedAtMs !== undefined) {
      questionResults.push({
        idx: q.idx,
        problemContestId: q.problem.contestId,
        problemIndex: q.problem.index,
        scores: { ...q.scores },
        firstSolveUserId: q.firstSolveUserId,
      });
    }
  }

  return {
    matchId: match.matchId,
    status: match.status,
    mode: match.mode,
    sheetId: match.sheetId,
    serverNow,
    currentQuestionIdx: match.currentQuestionIdx,
    questionCount: match.questionCount,
    countdownDeadlineMs: match.countdownDeadlineMs,
    questionStartedAtMs: currentQ?.startedAtMs,
    questionDeadlineMs: currentQ?.deadlineAtMs,
    breakDeadlineMs: match.breakDeadlineMs,
    // Only reveal currentProblem when question is ACTIVE or later (never during COUNTDOWN/LOBBY)
    currentProblem:
      match.status === 'ACTIVE' || match.status === 'FINISHED' ? currentQ?.problem : undefined,
    players,
    questionResults,
    paused: match.paused,
    winnerUserId: match.winnerUserId,
    endReason: match.endReason,
  };
}
