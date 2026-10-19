export interface ProblemDto {
  id: number;
  contestId: number;
  index: string;
  name: string;
  rating: number;
  tags: string[];
  url: string;
}

export interface PlayerStateSnapshot {
  userId: string;
  handle: string;
  rating: number;
  score: number;
  solvedCurrent: boolean;
  wrongAttemptsCurrent: number;
  connected: boolean;
}

export interface QuestionResultDto {
  idx: number;
  problemContestId: number;
  problemIndex: string;
  scores: Record<string, number>;
  firstSolveUserId?: string;
}

export type MatchLifecycleStatus = 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'FINISHED' | 'ABORTED';
export type MatchLifecycleMode = 'RANKED' | 'PRIVATE';

export interface MatchStateSnapshot {
  matchId: string;
  status: MatchLifecycleStatus;
  mode: MatchLifecycleMode;
  sheetId: string;
  serverNow: number;
  currentQuestionIdx: number;
  questionCount: number;
  countdownDeadlineMs?: number;
  questionStartedAtMs?: number;
  questionDeadlineMs?: number;
  breakDeadlineMs?: number;
  currentProblem?: ProblemDto;
  players: Record<string, PlayerStateSnapshot>;
  questionResults: QuestionResultDto[];
  paused: boolean;
  winnerUserId?: string;
  endReason?: string;
}

export interface ServerToClientEvents {
  'match:state': (snapshot: MatchStateSnapshot) => void;
  'match:found': (data: {
    matchId: string;
    opponent: { userId: string; handle: string; rating: number };
    serverNow: number;
  }) => void;
  'question:start': (data: {
    idx: number;
    problem: ProblemDto;
    startedAtMs: number;
    deadlineAtMs: number;
    serverNow: number;
  }) => void;
  'question:update': (data: {
    userId: string;
    solved: boolean;
    wrongAttempts: number;
    serverNow: number;
  }) => void;
  'question:end': (data: {
    idx: number;
    scores: Record<string, number>;
    firstSolveUserId?: string;
    breakDeadlineMs: number;
    serverNow: number;
  }) => void;
  'match:end': (data: {
    winnerUserId?: string;
    scores: Record<string, number>;
    endReason: string;
    serverNow: number;
  }) => void;
  'system:cf_degraded': (data: { serverNow: number }) => void;
  'system:cf_recovered': (data: { serverNow: number; extendedMs: number }) => void;
  'queue:status': (data: { waitedMs: number; window: number; serverNow: number }) => void;
  error: (data: { code: string; message: string; serverNow: number }) => void;
}

export interface ClientToServerEvents {
  'match:ready': (ack: (res: { ok: boolean; error?: string }) => void) => void;
  'match:submitted': (ack: (res: { ok: boolean; error?: string }) => void) => void;
  'match:resign': (ack: (res: { ok: boolean; error?: string }) => void) => void;
  'match:rejoin': (
    ack: (res: { ok: boolean; snapshot?: MatchStateSnapshot; error?: string }) => void,
  ) => void;
  'queue:join': (
    data: { sheetSlug: string },
    ack: (res: { ok: boolean; error?: string }) => void,
  ) => void;
  'queue:leave': (ack: (res: { ok: boolean }) => void) => void;
  'room:create': (
    data: { sheetSlug: string; questionCount?: number },
    ack: (res: { ok: boolean; roomCode?: string; error?: string }) => void,
  ) => void;
  'room:join': (
    data: { roomCode: string },
    ack: (res: { ok: boolean; matchId?: string; error?: string }) => void,
  ) => void;
}
