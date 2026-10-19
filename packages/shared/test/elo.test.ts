import { describe, expect, it } from 'vitest';
import {
  calculateExpectedScore,
  calculateMatchEloDeltas,
  getKFactor,
  outcomeToScore,
} from '../src/elo';
import { ELO_DEFAULTS } from '../src/constants';

describe('Pure Elo Calculations', () => {
  it('calculates logistic expectation correctly', () => {
    // Equal ratings -> 50% expectation
    expect(calculateExpectedScore(1500, 1500)).toBeCloseTo(0.5, 5);

    // 400 point advantage -> ~90.9% for higher rating, ~9.1% for lower
    const expectedHigher = calculateExpectedScore(1600, 1200);
    const expectedLower = calculateExpectedScore(1200, 1600);
    expect(expectedHigher).toBeCloseTo(0.90909, 4);
    expect(expectedLower).toBeCloseTo(0.09091, 4);
    expect(expectedHigher + expectedLower).toBeCloseTo(1.0, 5);
  });

  it('determines K-factor based on match count and anti-farming status', () => {
    // New player (< 10 matches) -> K = 40
    expect(getKFactor(0)).toBe(40);
    expect(getKFactor(9)).toBe(40);

    // Established player (>= 10 matches) -> K = 24
    expect(getKFactor(10)).toBe(24);
    expect(getKFactor(50)).toBe(24);

    // Anti-farming suspicion (halved K)
    expect(getKFactor(5, true)).toBe(20);
    expect(getKFactor(15, true)).toBe(12);
  });

  it('maps outcomes to correct score values', () => {
    expect(outcomeToScore('WIN')).toBe(1);
    expect(outcomeToScore('LOSS')).toBe(0);
    expect(outcomeToScore('DRAW')).toBe(0.5);
  });

  it('calculates symmetric match updates for equal established players', () => {
    // Both 1500, both >= 10 matches (K = 24)
    const result = calculateMatchEloDeltas(
      { rating: 1500, matchesPlayed: 10, result: 'WIN' },
      { rating: 1500, matchesPlayed: 10, result: 'LOSS' },
    );

    // Delta = round(24 * (1 - 0.5)) = +12
    expect(result.playerA.delta).toBe(12);
    expect(result.playerA.newRating).toBe(1512);
    expect(result.playerA.peakRating).toBe(1512);

    // Delta = round(24 * (0 - 0.5)) = -12
    expect(result.playerB.delta).toBe(-12);
    expect(result.playerB.newRating).toBe(1488);
    expect(result.playerB.peakRating).toBe(1500); // peak retained
  });

  it('calculates provisional updates for new players with K = 40', () => {
    const result = calculateMatchEloDeltas(
      { rating: 1500, matchesPlayed: 2, result: 'WIN' },
      { rating: 1500, matchesPlayed: 2, result: 'LOSS' },
    );

    // Delta = round(40 * (1 - 0.5)) = +20
    expect(result.playerA.delta).toBe(20);
    expect(result.playerA.newRating).toBe(1520);

    expect(result.playerB.delta).toBe(-20);
    expect(result.playerB.newRating).toBe(1480);
  });

  it('handles asymmetric K-factors when one player is new and one is established', () => {
    const result = calculateMatchEloDeltas(
      { rating: 1500, matchesPlayed: 2, result: 'WIN' }, // new -> K = 40
      { rating: 1500, matchesPlayed: 20, result: 'LOSS' }, // established -> K = 24
    );

    expect(result.playerA.delta).toBe(20);
    expect(result.playerA.newRating).toBe(1520);

    expect(result.playerB.delta).toBe(-12);
    expect(result.playerB.newRating).toBe(1488);
  });

  it('halves K-factor when anti-farming condition is met', () => {
    const result = calculateMatchEloDeltas(
      { rating: 1500, matchesPlayed: 20, result: 'WIN' },
      { rating: 1500, matchesPlayed: 20, result: 'LOSS' },
      { isFarmingSuspect: true },
    );

    // Standard K = 24 -> halved to K = 12
    // Delta = round(12 * (1 - 0.5)) = +6
    expect(result.playerA.delta).toBe(6);
    expect(result.playerA.newRating).toBe(1506);
    expect(result.playerB.delta).toBe(-6);
    expect(result.playerB.newRating).toBe(1494);
  });

  it('handles draws with 0 delta for equal ratings', () => {
    const result = calculateMatchEloDeltas(
      { rating: 1500, matchesPlayed: 15, result: 'DRAW' },
      { rating: 1500, matchesPlayed: 15, result: 'DRAW' },
    );

    expect(result.playerA.delta).toBe(0);
    expect(result.playerA.newRating).toBe(1500);
    expect(result.playerB.delta).toBe(0);
    expect(result.playerB.newRating).toBe(1500);
  });

  it('enforces rating floor at 100 points', () => {
    const result = calculateMatchEloDeltas(
      { rating: 105, matchesPlayed: 10, result: 'WIN' },
      { rating: 105, matchesPlayed: 10, result: 'LOSS' },
    );

    // Normally would lose rating (-12), but rating cannot drop below 100
    expect(result.playerB.newRating).toBe(ELO_DEFAULTS.floor);
    expect(result.playerB.delta).toBe(ELO_DEFAULTS.floor - 105); // -5 instead of -12
  });
});
