import {
  QUESTION_CAPS_DEFAULT,
  SCORING_DEFAULTS,
  type QuestionCapRule,
  type ScoringParams,
} from './constants';

export const PENALTY_VERDICTS = new Set<string>([
  'WRONG_ANSWER',
  'RUNTIME_ERROR',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'IDLENESS_LIMIT_EXCEEDED',
]);

/** Returns true if a submission verdict penalizes the player's score. */
export function isPenaltyVerdict(verdict: string): boolean {
  return PENALTY_VERDICTS.has(verdict.toUpperCase());
}

/**
 * Pure scoring calculation (blueprint §11).
 *
 * @param capMs Maximum allowed time for this question in milliseconds
 * @param solveTimeMs Time taken to achieve the accepted verdict, or null if unsolved
 * @param wrongAttempts Number of penalty-incurring submissions before the accepted solution
 * @param isFirstSolve Whether this player had the earliest accepted solution among all players
 * @param params Tunable scoring parameters
 */
export function calculateScore(
  capMs: number,
  solveTimeMs: number | null,
  wrongAttempts: number,
  isFirstSolve: boolean,
  params: ScoringParams = SCORING_DEFAULTS,
): number {
  if (solveTimeMs === null) {
    return 0; // Unsolved problems score 0
  }

  const clampedSolveTime = Math.max(0, Math.min(capMs, solveTimeMs));
  const timeFraction = capMs > 0 ? clampedSolveTime / capMs : 1;
  const timeFactor = 1 - (1 - params.minTimeFactor) * timeFraction;
  const rawPoints = Math.round(params.base * timeFactor);
  const penalty = params.wrongPenalty * Math.min(Math.max(0, wrongAttempts), params.wrongMax);
  let points = Math.max(rawPoints - penalty, params.minPoints);

  if (isFirstSolve) {
    points += params.firstSolveBonus;
  }

  return points;
}

/**
 * Returns the maximum time limit (in ms) for a question based on problem rating.
 */
export function getQuestionCapMs(
  rating: number,
  rules: readonly QuestionCapRule[] = QUESTION_CAPS_DEFAULT,
): number {
  for (const rule of rules) {
    if (rule.belowRating === null || rating < rule.belowRating) {
      return rule.capMs;
    }
  }
  return 35 * 60 * 1000;
}
