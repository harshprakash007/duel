/**
 * Default values for every tunable in the system (blueprint §21).
 * The API config module (apps/api/src/config) reads env overrides on top of these;
 * the web app uses them only for previews. Nothing else should hard-code these numbers.
 */

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;

export const MATCH_DEFAULTS = {
  questionCount: 3,
  questionCountMin: 3,
  questionCountMax: 5,
  countdownMs: 5 * SEC,
  breakMs: 5 * SEC,
  postFirstSolveMs: 180 * SEC,
  noShowTimeoutMs: 20 * SEC,
  preStartAbsenceMs: 2 * MIN,
  cfOutageAbortMs: 10 * MIN,
  cfStalePollMs: 20 * SEC,
} as const;

/** Question time cap by problem rating. Sorted ascending by `belowRating`; last entry is the fallback. */
export interface QuestionCapRule {
  /** Applies when rating < belowRating. `null` means "everything else". */
  belowRating: number | null;
  capMs: number;
}

export const QUESTION_CAPS_DEFAULT: readonly QuestionCapRule[] = [
  { belowRating: 1100, capMs: 10 * MIN },
  { belowRating: 1400, capMs: 15 * MIN },
  { belowRating: 1700, capMs: 20 * MIN },
  { belowRating: 2000, capMs: 25 * MIN },
  { belowRating: null, capMs: 35 * MIN },
];

export interface ScoringParams {
  base: number;
  minTimeFactor: number;
  wrongPenalty: number;
  wrongMax: number;
  minPoints: number;
  firstSolveBonus: number;
}

export const SCORING_DEFAULTS: ScoringParams = {
  base: 1000,
  minTimeFactor: 0.3,
  wrongPenalty: 50,
  wrongMax: 6,
  minPoints: 150,
  firstSolveBonus: 100,
};

export interface EloParams {
  kNew: number;
  k: number;
  newPlayerMatches: number;
  floor: number;
  /** Divisor in the logistic expectation formula. */
  scale: number;
  repeatPairThreshold: number;
  repeatPairWindowMs: number;
  repeatPairKMultiplier: number;
}

export const ELO_DEFAULTS: EloParams = {
  kNew: 40,
  k: 24,
  newPlayerMatches: 10,
  floor: 100,
  scale: 400,
  repeatPairThreshold: 3,
  repeatPairWindowMs: 24 * 60 * MIN,
  repeatPairKMultiplier: 0.5,
};

export const RATING_INIT_DEFAULTS = {
  fallback: 1000,
  min: 800,
  max: 2400,
} as const;

export interface MatchmakingWindowParams {
  base: number;
  step: number;
  stepEverySec: number;
  max: number;
}

export const MATCHMAKING_DEFAULTS = {
  tickMs: 1 * SEC,
  window: { base: 100, step: 50, stepEverySec: 5, max: 600 } satisfies MatchmakingWindowParams,
  recentOpponentCount: 3,
  recentOpponentWaiveMs: 60 * SEC,
  statusIntervalMs: 2 * SEC,
  roomCodeLength: 6,
  roomTtlMs: 10 * MIN,
} as const;

/** Room code alphabet with ambiguous characters (0/O, 1/I/L) removed. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface PickerParams {
  recentMatchesExcluded: number;
  snap: number;
  window: number;
  windowStep: number;
}

export const PICKER_DEFAULTS: PickerParams = {
  recentMatchesExcluded: 50,
  snap: 100,
  window: 100,
  windowStep: 100,
};

export const POLLER_DEFAULTS = {
  intervalMs: 5 * SEC,
  recentCount: 1000,
  hintCooldownMs: 5 * SEC,
  hintStatusCount: 5,
  gapStatusCount: 10,
  pendingRecheckMs: 3 * SEC,
  startSlackMs: 3 * SEC,
} as const;

export const CF_CLIENT_DEFAULTS = {
  baseUrl: 'https://codeforces.com/api',
  maxRps: 2,
  timeoutMs: 30 * SEC,
  retryMax: 3,
  retryBaseMs: 500,
  retryMaxDelayMs: 8 * SEC,
  degradedAfterFailures: 4,
} as const;

export const LEADERBOARD_DEFAULTS = {
  minRankedMatches: 5,
  pageLimitMax: 100,
  pageLimitDefault: 50,
} as const;

export const HANDLE_DEFAULTS = {
  verifyWindowMs: 5 * MIN,
  verifySlackMs: 5 * SEC,
  verifyStatusCount: 10,
  verifyProblems: ['4A', '71A', '231A', '158A', '282A'] as readonly string[],
  rateLimitPerHour: 10,
} as const;

export const SHEET_DEFAULTS = {
  minSolvedCount: 300,
  questionCount: 3,
} as const;

export const CATALOG_DEFAULTS = {
  excludeTags: ['*special', 'interactive'] as readonly string[],
} as const;

export const CF_PROBLEM_URL = (contestId: number, index: string): string =>
  `https://codeforces.com/problemset/problem/${contestId}/${index}`;
