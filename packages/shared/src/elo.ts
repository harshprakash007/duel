import { ELO_DEFAULTS, type EloParams } from './constants';

export type MatchOutcome = 'WIN' | 'LOSS' | 'DRAW';

export interface PlayerEloInput {
  rating: number;
  matchesPlayed: number;
  result: MatchOutcome;
}

export interface PlayerEloResult {
  delta: number;
  newRating: number;
  peakRating: number;
  expectedScore: number;
  actualScore: number;
  kFactor: number;
}

export interface MatchEloResult {
  playerA: PlayerEloResult;
  playerB: PlayerEloResult;
}

/**
 * Calculates the expected score of player A against player B in [0, 1].
 * Formula: E_A = 1 / (1 + 10 ^ ((R_B - R_A) / scale))
 */
export function calculateExpectedScore(
  ratingA: number,
  ratingB: number,
  scale = ELO_DEFAULTS.scale,
): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / scale));
}

/**
 * Resolves the K-factor for a player given their matches played and anti-farming status.
 */
export function getKFactor(
  matchesPlayed: number,
  isFarmingSuspect = false,
  params: EloParams = ELO_DEFAULTS,
): number {
  let k = matchesPlayed < params.newPlayerMatches ? params.kNew : params.k;
  if (isFarmingSuspect) {
    k = Math.round(k * params.repeatPairKMultiplier);
  }
  return k;
}

/**
 * Maps match outcome to numeric score: WIN = 1, LOSS = 0, DRAW = 0.5.
 */
export function outcomeToScore(outcome: MatchOutcome): number {
  switch (outcome) {
    case 'WIN':
      return 1;
    case 'LOSS':
      return 0;
    case 'DRAW':
      return 0.5;
  }
}

/**
 * Computes authoritative Elo rating updates for both players in a 1v1 match.
 */
export function calculateMatchEloDeltas(
  playerA: PlayerEloInput,
  playerB: PlayerEloInput,
  options?: {
    isFarmingSuspect?: boolean;
    peakRatingA?: number;
    peakRatingB?: number;
    params?: EloParams;
  },
): MatchEloResult {
  const params = options?.params ?? ELO_DEFAULTS;
  const isFarming = options?.isFarmingSuspect ?? false;

  const expectedA = calculateExpectedScore(playerA.rating, playerB.rating, params.scale);
  const expectedB = 1 - expectedA;

  const actualA = outcomeToScore(playerA.result);
  const actualB = outcomeToScore(playerB.result);

  const kA = getKFactor(playerA.matchesPlayed, isFarming, params);
  const kB = getKFactor(playerB.matchesPlayed, isFarming, params);

  const rawDeltaA = Math.round(kA * (actualA - expectedA));
  const rawDeltaB = Math.round(kB * (actualB - expectedB));

  const newRatingA = Math.max(params.floor, playerA.rating + rawDeltaA);
  const newRatingB = Math.max(params.floor, playerB.rating + rawDeltaB);

  const effectiveDeltaA = newRatingA - playerA.rating;
  const effectiveDeltaB = newRatingB - playerB.rating;

  const peakA = Math.max(options?.peakRatingA ?? playerA.rating, newRatingA);
  const peakB = Math.max(options?.peakRatingB ?? playerB.rating, newRatingB);

  return {
    playerA: {
      delta: effectiveDeltaA,
      newRating: newRatingA,
      peakRating: peakA,
      expectedScore: expectedA,
      actualScore: actualA,
      kFactor: kA,
    },
    playerB: {
      delta: effectiveDeltaB,
      newRating: newRatingB,
      peakRating: peakB,
      expectedScore: expectedB,
      actualScore: actualB,
      kFactor: kB,
    },
  };
}
