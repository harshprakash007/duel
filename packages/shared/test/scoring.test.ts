import { describe, expect, it } from 'vitest';
import {
  calculateScore,
  getQuestionCapMs,
  isPenaltyVerdict,
  PENALTY_VERDICTS,
} from '../src/scoring';
import { MIN } from '../src/constants';

describe('Scoring pure functions (blueprint §11)', () => {
  describe('calculateScore', () => {
    it('matches the worked example from §11: cap 15m, solve 5m, 1 wrong, first solve => 817', () => {
      const capMs = 15 * MIN;
      const solveTimeMs = 5 * MIN;
      const wrongAttempts = 1;
      const isFirstSolve = true;

      const score = calculateScore(capMs, solveTimeMs, wrongAttempts, isFirstSolve);
      expect(score).toBe(817);
    });

    it('returns 0 for unsolved problems regardless of wrong attempts', () => {
      const capMs = 15 * MIN;
      expect(calculateScore(capMs, null, 0, false)).toBe(0);
      expect(calculateScore(capMs, null, 3, false)).toBe(0);
      expect(calculateScore(capMs, null, 6, true)).toBe(0);
    });

    it('awards maximum points for instant solve with first solve bonus', () => {
      const capMs = 15 * MIN;
      // 1000 base + 100 first solve bonus = 1100
      expect(calculateScore(capMs, 0, 0, true)).toBe(1100);
      // without first solve bonus = 1000
      expect(calculateScore(capMs, 0, 0, false)).toBe(1000);
    });

    it('applies minTimeFactor at capMs (solve time == capMs)', () => {
      const capMs = 15 * MIN;
      // timeFactor = 0.3 => 300 points
      expect(calculateScore(capMs, capMs, 0, false)).toBe(300);
    });

    it('enforces minPoints floor of 150 when penalties reduce score below floor', () => {
      const capMs = 15 * MIN;
      // At capMs, rawPoints = 300.
      // 6 wrong attempts = 300 penalty. 300 - 300 = 0 -> clamped to 150 floor.
      expect(calculateScore(capMs, capMs, 6, false)).toBe(150);
    });

    it('clamps wrong attempts penalty to wrongMax (6 attempts)', () => {
      const capMs = 15 * MIN;
      // 6 attempts and 10 attempts incur the same penalty (300)
      const score6 = calculateScore(capMs, 1 * MIN, 6, false);
      const score10 = calculateScore(capMs, 1 * MIN, 10, false);
      expect(score6).toBe(score10);
    });

    it('adds first solve bonus on top of the minPoints floor', () => {
      const capMs = 15 * MIN;
      // Floor (150) + first solve bonus (100) = 250
      expect(calculateScore(capMs, capMs, 6, true)).toBe(250);
    });

    it('clamps negative or excessive solveTimeMs into [0, capMs]', () => {
      const capMs = 15 * MIN;
      // Negative solveTime clamped to 0
      expect(calculateScore(capMs, -5000, 0, false)).toBe(1000);
      // SolveTime > capMs clamped to capMs
      expect(calculateScore(capMs, 20 * MIN, 0, false)).toBe(300);
    });
  });

  describe('isPenaltyVerdict', () => {
    it('correctly classifies verdicts that count as wrong attempts', () => {
      for (const v of PENALTY_VERDICTS) {
        expect(isPenaltyVerdict(v)).toBe(true);
        expect(isPenaltyVerdict(v.toLowerCase())).toBe(true);
      }
    });

    it('does not penalize compilation errors or non-penalizing verdicts', () => {
      expect(isPenaltyVerdict('COMPILATION_ERROR')).toBe(false);
      expect(isPenaltyVerdict('OK')).toBe(false);
      expect(isPenaltyVerdict('TESTING')).toBe(false);
      expect(isPenaltyVerdict('SUBMITTED')).toBe(false);
      expect(isPenaltyVerdict('SKIPPED')).toBe(false);
      expect(isPenaltyVerdict('REJECTED')).toBe(false);
    });
  });

  describe('getQuestionCapMs', () => {
    it('returns correct question cap by problem rating (§21)', () => {
      expect(getQuestionCapMs(800)).toBe(10 * MIN);
      expect(getQuestionCapMs(1000)).toBe(10 * MIN);
      expect(getQuestionCapMs(1100)).toBe(15 * MIN);
      expect(getQuestionCapMs(1300)).toBe(15 * MIN);
      expect(getQuestionCapMs(1400)).toBe(20 * MIN);
      expect(getQuestionCapMs(1600)).toBe(20 * MIN);
      expect(getQuestionCapMs(1700)).toBe(25 * MIN);
      expect(getQuestionCapMs(1900)).toBe(25 * MIN);
      expect(getQuestionCapMs(2000)).toBe(35 * MIN);
      expect(getQuestionCapMs(2400)).toBe(35 * MIN);
      expect(getQuestionCapMs(3000)).toBe(35 * MIN);
    });
  });
});
