import { z } from 'zod';
import {
  CATALOG_DEFAULTS,
  CF_CLIENT_DEFAULTS,
  ELO_DEFAULTS,
  HANDLE_DEFAULTS,
  LEADERBOARD_DEFAULTS,
  MATCHMAKING_DEFAULTS,
  MATCH_DEFAULTS,
  PICKER_DEFAULTS,
  POLLER_DEFAULTS,
  QUESTION_CAPS_DEFAULT,
  RATING_INIT_DEFAULTS,
  SCORING_DEFAULTS,
  SHEET_DEFAULTS,
  type EloParams,
  type MatchmakingWindowParams,
  type PickerParams,
  type QuestionCapRule,
  type ScoringParams,
} from '@duel/shared';

/**
 * The single config module (blueprint §0, §18, §21).
 * Every tunable is read from env here, with defaults from `@duel/shared` constants.
 */

const int = (def: number) => z.coerce.number().int().default(def);
const num = (def: number) => z.coerce.number().default(def);
const pos = (def: number) => z.coerce.number().int().positive().default(def);
const csv = (def: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined
        ? [...def]
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

const capRule = z.object({
  belowRating: z.number().int().nullable(),
  capMs: z.number().int().positive(),
});

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().nonnegative().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  INSTANCE_ID: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_SEC: pos(7 * 24 * 3600),
  COOKIE_NAME: z.string().default('duel_session'),
  COOKIE_SECURE: z.stringbool().optional(),
  CORS_ORIGIN: csv(['http://localhost:5173']),
  TRUST_PROXY: z.stringbool().default(false),

  CF_BASE_URL: z.string().url().default(CF_CLIENT_DEFAULTS.baseUrl),
  CF_MAX_RPS: num(CF_CLIENT_DEFAULTS.maxRps),
  CF_USER_AGENT: z
    .string()
    .min(1)
    .default('Duel/0.1 (+https://github.com/duel; contact: admin@example.com)'),
  CF_TIMEOUT_MS: pos(CF_CLIENT_DEFAULTS.timeoutMs),
  CF_RETRY_MAX: int(CF_CLIENT_DEFAULTS.retryMax),
  CF_RETRY_BASE_MS: pos(CF_CLIENT_DEFAULTS.retryBaseMs),
  CF_RETRY_MAX_DELAY_MS: pos(CF_CLIENT_DEFAULTS.retryMaxDelayMs),
  CF_DEGRADED_AFTER_FAILURES: pos(CF_CLIENT_DEFAULTS.degradedAfterFailures),

  POLL_INTERVAL_MS: pos(POLLER_DEFAULTS.intervalMs),
  POLL_RECENT_COUNT: pos(POLLER_DEFAULTS.recentCount),
  POLL_HINT_COOLDOWN_MS: pos(POLLER_DEFAULTS.hintCooldownMs),
  POLL_HINT_STATUS_COUNT: pos(POLLER_DEFAULTS.hintStatusCount),
  POLL_GAP_STATUS_COUNT: pos(POLLER_DEFAULTS.gapStatusCount),
  POLL_PENDING_RECHECK_MS: pos(POLLER_DEFAULTS.pendingRecheckMs),
  POLL_START_SLACK_MS: int(POLLER_DEFAULTS.startSlackMs),

  MATCH_QUESTION_COUNT: pos(MATCH_DEFAULTS.questionCount),
  MATCH_QUESTION_COUNT_MIN: pos(MATCH_DEFAULTS.questionCountMin),
  MATCH_QUESTION_COUNT_MAX: pos(MATCH_DEFAULTS.questionCountMax),
  MATCH_COUNTDOWN_MS: pos(MATCH_DEFAULTS.countdownMs),
  MATCH_BREAK_MS: pos(MATCH_DEFAULTS.breakMs),
  MATCH_POST_FIRST_SOLVE_MS: pos(MATCH_DEFAULTS.postFirstSolveMs),
  MATCH_NO_SHOW_TIMEOUT_MS: pos(MATCH_DEFAULTS.noShowTimeoutMs),
  MATCH_PRE_START_ABSENCE_MS: pos(MATCH_DEFAULTS.preStartAbsenceMs),
  MATCH_CF_OUTAGE_ABORT_MS: pos(MATCH_DEFAULTS.cfOutageAbortMs),
  MATCH_CF_STALE_POLL_MS: pos(MATCH_DEFAULTS.cfStalePollMs),
  QUESTION_CAPS_JSON: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return [...QUESTION_CAPS_DEFAULT];
      try {
        return z.array(capRule).min(1).parse(JSON.parse(v));
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: `invalid QUESTION_CAPS_JSON: ${String(e)}` });
        return z.NEVER;
      }
    }),

  SCORE_BASE: num(SCORING_DEFAULTS.base),
  SCORE_MIN_TIME_FACTOR: num(SCORING_DEFAULTS.minTimeFactor),
  SCORE_WRONG_PENALTY: num(SCORING_DEFAULTS.wrongPenalty),
  SCORE_WRONG_MAX: int(SCORING_DEFAULTS.wrongMax),
  SCORE_MIN_POINTS: num(SCORING_DEFAULTS.minPoints),
  SCORE_FIRST_SOLVE_BONUS: num(SCORING_DEFAULTS.firstSolveBonus),

  ELO_K_NEW: num(ELO_DEFAULTS.kNew),
  ELO_K: num(ELO_DEFAULTS.k),
  ELO_NEW_PLAYER_MATCHES: int(ELO_DEFAULTS.newPlayerMatches),
  ELO_FLOOR: num(ELO_DEFAULTS.floor),
  ELO_SCALE: num(ELO_DEFAULTS.scale),
  ELO_REPEAT_PAIR_THRESHOLD: int(ELO_DEFAULTS.repeatPairThreshold),
  ELO_REPEAT_PAIR_WINDOW_MS: pos(ELO_DEFAULTS.repeatPairWindowMs),
  ELO_REPEAT_PAIR_K_MULTIPLIER: num(ELO_DEFAULTS.repeatPairKMultiplier),
  RATING_INIT_FALLBACK: int(RATING_INIT_DEFAULTS.fallback),
  RATING_INIT_MIN: int(RATING_INIT_DEFAULTS.min),
  RATING_INIT_MAX: int(RATING_INIT_DEFAULTS.max),

  MM_TICK_MS: pos(MATCHMAKING_DEFAULTS.tickMs),
  MM_WINDOW_BASE: int(MATCHMAKING_DEFAULTS.window.base),
  MM_WINDOW_STEP: int(MATCHMAKING_DEFAULTS.window.step),
  MM_WINDOW_STEP_EVERY_SEC: pos(MATCHMAKING_DEFAULTS.window.stepEverySec),
  MM_WINDOW_MAX: int(MATCHMAKING_DEFAULTS.window.max),
  MM_RECENT_OPPONENT_COUNT: int(MATCHMAKING_DEFAULTS.recentOpponentCount),
  MM_RECENT_OPPONENT_WAIVE_MS: pos(MATCHMAKING_DEFAULTS.recentOpponentWaiveMs),
  MM_STATUS_INTERVAL_MS: pos(MATCHMAKING_DEFAULTS.statusIntervalMs),
  ROOM_CODE_LENGTH: pos(MATCHMAKING_DEFAULTS.roomCodeLength),
  ROOM_TTL_MS: pos(MATCHMAKING_DEFAULTS.roomTtlMs),

  PICKER_RECENT_MATCHES: int(PICKER_DEFAULTS.recentMatchesExcluded),
  PICKER_SNAP: pos(PICKER_DEFAULTS.snap),
  PICKER_WINDOW: pos(PICKER_DEFAULTS.window),
  PICKER_WINDOW_STEP: pos(PICKER_DEFAULTS.windowStep),

  LB_MIN_RANKED_MATCHES: int(LEADERBOARD_DEFAULTS.minRankedMatches),
  LB_PAGE_LIMIT_MAX: pos(LEADERBOARD_DEFAULTS.pageLimitMax),
  LB_PAGE_LIMIT_DEFAULT: pos(LEADERBOARD_DEFAULTS.pageLimitDefault),

  HANDLE_VERIFY_WINDOW_MS: pos(HANDLE_DEFAULTS.verifyWindowMs),
  HANDLE_VERIFY_SLACK_MS: int(HANDLE_DEFAULTS.verifySlackMs),
  HANDLE_VERIFY_STATUS_COUNT: pos(HANDLE_DEFAULTS.verifyStatusCount),
  HANDLE_VERIFY_PROBLEMS: csv(HANDLE_DEFAULTS.verifyProblems),
  HANDLE_RATE_LIMIT_PER_HOUR: pos(HANDLE_DEFAULTS.rateLimitPerHour),

  AUTH_RATE_LIMIT_WINDOW_MS: pos(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: pos(20),
  API_RATE_LIMIT_WINDOW_MS: pos(60 * 1000),
  API_RATE_LIMIT_MAX: pos(300),

  SHEET_MIN_SOLVED_COUNT: int(SHEET_DEFAULTS.minSolvedCount),
  SHEET_QUESTION_COUNT: pos(SHEET_DEFAULTS.questionCount),
  CATALOG_EXCLUDE_TAGS: csv(CATALOG_DEFAULTS.excludeTags),
  CATALOG_SYNC_CRON: z.string().default('0 3 * * *'),
  LB_REBUILD_CRON: z.string().default('30 3 * * *'),
  JOBS_ENABLED: z.stringbool().default(true),

  LEADER_LOCK_TTL_MS: pos(10_000),
  LEADER_LOCK_RENEW_MS: pos(3_000),
  SHUTDOWN_GRACE_MS: pos(10_000),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface Config {
  env: RawEnv['NODE_ENV'];
  isProd: boolean;
  isTest: boolean;
  port: number;
  logLevel: RawEnv['LOG_LEVEL'];
  instanceId: string;
  databaseUrl: string;
  redisUrl: string;
  auth: {
    jwtSecret: string;
    jwtExpiresSec: number;
    cookieName: string;
    cookieSecure: boolean;
    rateLimitWindowMs: number;
    rateLimitMax: number;
  };
  http: {
    corsOrigins: string[];
    trustProxy: boolean;
    apiRateLimitWindowMs: number;
    apiRateLimitMax: number;
    shutdownGraceMs: number;
  };
  cf: {
    baseUrl: string;
    maxRps: number;
    userAgent: string;
    timeoutMs: number;
    retryMax: number;
    retryBaseMs: number;
    retryMaxDelayMs: number;
    degradedAfterFailures: number;
  };
  poller: {
    intervalMs: number;
    recentCount: number;
    hintCooldownMs: number;
    hintStatusCount: number;
    gapStatusCount: number;
    pendingRecheckMs: number;
    startSlackMs: number;
  };
  match: {
    questionCount: number;
    questionCountMin: number;
    questionCountMax: number;
    countdownMs: number;
    breakMs: number;
    postFirstSolveMs: number;
    noShowTimeoutMs: number;
    preStartAbsenceMs: number;
    cfOutageAbortMs: number;
    cfStalePollMs: number;
    questionCaps: QuestionCapRule[];
  };
  scoring: ScoringParams;
  elo: EloParams;
  ratingInit: { fallback: number; min: number; max: number };
  matchmaking: {
    tickMs: number;
    window: MatchmakingWindowParams;
    recentOpponentCount: number;
    recentOpponentWaiveMs: number;
    statusIntervalMs: number;
    roomCodeLength: number;
    roomTtlMs: number;
  };
  picker: PickerParams;
  leaderboard: { minRankedMatches: number; pageLimitMax: number; pageLimitDefault: number };
  handles: {
    verifyWindowMs: number;
    verifySlackMs: number;
    verifyStatusCount: number;
    verifyProblems: string[];
    rateLimitPerHour: number;
  };
  catalog: {
    sheetMinSolvedCount: number;
    sheetQuestionCount: number;
    excludeTags: string[];
    syncCron: string;
    leaderboardRebuildCron: string;
    jobsEnabled: boolean;
  };
  leader: { ttlMs: number; renewMs: number };
}

export class ConfigError extends Error {}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.MATCH_QUESTION_COUNT_MIN > e.MATCH_QUESTION_COUNT_MAX) {
    throw new ConfigError('MATCH_QUESTION_COUNT_MIN must be <= MATCH_QUESTION_COUNT_MAX');
  }
  const isProd = e.NODE_ENV === 'production';
  return {
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    instanceId: e.INSTANCE_ID ?? `${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    auth: {
      jwtSecret: e.JWT_SECRET,
      jwtExpiresSec: e.JWT_EXPIRES_SEC,
      cookieName: e.COOKIE_NAME,
      cookieSecure: e.COOKIE_SECURE ?? isProd,
      rateLimitWindowMs: e.AUTH_RATE_LIMIT_WINDOW_MS,
      rateLimitMax: e.AUTH_RATE_LIMIT_MAX,
    },
    http: {
      corsOrigins: e.CORS_ORIGIN,
      trustProxy: e.TRUST_PROXY,
      apiRateLimitWindowMs: e.API_RATE_LIMIT_WINDOW_MS,
      apiRateLimitMax: e.API_RATE_LIMIT_MAX,
      shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
    },
    cf: {
      baseUrl: e.CF_BASE_URL,
      maxRps: e.CF_MAX_RPS,
      userAgent: e.CF_USER_AGENT,
      timeoutMs: e.CF_TIMEOUT_MS,
      retryMax: e.CF_RETRY_MAX,
      retryBaseMs: e.CF_RETRY_BASE_MS,
      retryMaxDelayMs: e.CF_RETRY_MAX_DELAY_MS,
      degradedAfterFailures: e.CF_DEGRADED_AFTER_FAILURES,
    },
    poller: {
      intervalMs: e.POLL_INTERVAL_MS,
      recentCount: e.POLL_RECENT_COUNT,
      hintCooldownMs: e.POLL_HINT_COOLDOWN_MS,
      hintStatusCount: e.POLL_HINT_STATUS_COUNT,
      gapStatusCount: e.POLL_GAP_STATUS_COUNT,
      pendingRecheckMs: e.POLL_PENDING_RECHECK_MS,
      startSlackMs: e.POLL_START_SLACK_MS,
    },
    match: {
      questionCount: e.MATCH_QUESTION_COUNT,
      questionCountMin: e.MATCH_QUESTION_COUNT_MIN,
      questionCountMax: e.MATCH_QUESTION_COUNT_MAX,
      countdownMs: e.MATCH_COUNTDOWN_MS,
      breakMs: e.MATCH_BREAK_MS,
      postFirstSolveMs: e.MATCH_POST_FIRST_SOLVE_MS,
      noShowTimeoutMs: e.MATCH_NO_SHOW_TIMEOUT_MS,
      preStartAbsenceMs: e.MATCH_PRE_START_ABSENCE_MS,
      cfOutageAbortMs: e.MATCH_CF_OUTAGE_ABORT_MS,
      cfStalePollMs: e.MATCH_CF_STALE_POLL_MS,
      questionCaps: e.QUESTION_CAPS_JSON,
    },
    scoring: {
      base: e.SCORE_BASE,
      minTimeFactor: e.SCORE_MIN_TIME_FACTOR,
      wrongPenalty: e.SCORE_WRONG_PENALTY,
      wrongMax: e.SCORE_WRONG_MAX,
      minPoints: e.SCORE_MIN_POINTS,
      firstSolveBonus: e.SCORE_FIRST_SOLVE_BONUS,
    },
    elo: {
      kNew: e.ELO_K_NEW,
      k: e.ELO_K,
      newPlayerMatches: e.ELO_NEW_PLAYER_MATCHES,
      floor: e.ELO_FLOOR,
      scale: e.ELO_SCALE,
      repeatPairThreshold: e.ELO_REPEAT_PAIR_THRESHOLD,
      repeatPairWindowMs: e.ELO_REPEAT_PAIR_WINDOW_MS,
      repeatPairKMultiplier: e.ELO_REPEAT_PAIR_K_MULTIPLIER,
    },
    ratingInit: {
      fallback: e.RATING_INIT_FALLBACK,
      min: e.RATING_INIT_MIN,
      max: e.RATING_INIT_MAX,
    },
    matchmaking: {
      tickMs: e.MM_TICK_MS,
      window: {
        base: e.MM_WINDOW_BASE,
        step: e.MM_WINDOW_STEP,
        stepEverySec: e.MM_WINDOW_STEP_EVERY_SEC,
        max: e.MM_WINDOW_MAX,
      },
      recentOpponentCount: e.MM_RECENT_OPPONENT_COUNT,
      recentOpponentWaiveMs: e.MM_RECENT_OPPONENT_WAIVE_MS,
      statusIntervalMs: e.MM_STATUS_INTERVAL_MS,
      roomCodeLength: e.ROOM_CODE_LENGTH,
      roomTtlMs: e.ROOM_TTL_MS,
    },
    picker: {
      recentMatchesExcluded: e.PICKER_RECENT_MATCHES,
      snap: e.PICKER_SNAP,
      window: e.PICKER_WINDOW,
      windowStep: e.PICKER_WINDOW_STEP,
    },
    leaderboard: {
      minRankedMatches: e.LB_MIN_RANKED_MATCHES,
      pageLimitMax: e.LB_PAGE_LIMIT_MAX,
      pageLimitDefault: e.LB_PAGE_LIMIT_DEFAULT,
    },
    handles: {
      verifyWindowMs: e.HANDLE_VERIFY_WINDOW_MS,
      verifySlackMs: e.HANDLE_VERIFY_SLACK_MS,
      verifyStatusCount: e.HANDLE_VERIFY_STATUS_COUNT,
      verifyProblems: e.HANDLE_VERIFY_PROBLEMS,
      rateLimitPerHour: e.HANDLE_RATE_LIMIT_PER_HOUR,
    },
    catalog: {
      sheetMinSolvedCount: e.SHEET_MIN_SOLVED_COUNT,
      sheetQuestionCount: e.SHEET_QUESTION_COUNT,
      excludeTags: e.CATALOG_EXCLUDE_TAGS,
      syncCron: e.CATALOG_SYNC_CRON,
      leaderboardRebuildCron: e.LB_REBUILD_CRON,
      jobsEnabled: e.JOBS_ENABLED,
    },
    leader: { ttlMs: e.LEADER_LOCK_TTL_MS, renewMs: e.LEADER_LOCK_RENEW_MS },
  };
}
