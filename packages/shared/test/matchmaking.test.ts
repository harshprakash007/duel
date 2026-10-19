import { describe, expect, it } from 'vitest';
import {
  calculateMatchmakingWindow,
  generateRoomCode,
  isRatingWithinWindow,
} from '../src/matchmaking';
import { ROOM_CODE_ALPHABET } from '../src/constants';

describe('Matchmaking Pure Functions', () => {
  describe('calculateMatchmakingWindow', () => {
    it('returns base window (100) at 0 seconds wait', () => {
      expect(calculateMatchmakingWindow(0)).toBe(100);
    });

    it('returns base window (100) before first step interval (<5s)', () => {
      expect(calculateMatchmakingWindow(1)).toBe(100);
      expect(calculateMatchmakingWindow(4.9)).toBe(100);
    });

    it('expands by +50 at 5 seconds wait (150)', () => {
      expect(calculateMatchmakingWindow(5)).toBe(150);
      expect(calculateMatchmakingWindow(9)).toBe(150);
    });

    it('expands to 200 at 10 seconds wait', () => {
      expect(calculateMatchmakingWindow(10)).toBe(200);
    });

    it('expands to 350 at 25 seconds wait', () => {
      expect(calculateMatchmakingWindow(25)).toBe(350);
    });

    it('caps window at max (600) for long wait times', () => {
      expect(calculateMatchmakingWindow(50)).toBe(600);
      expect(calculateMatchmakingWindow(60)).toBe(600);
      expect(calculateMatchmakingWindow(300)).toBe(600);
    });

    it('handles negative wait gracefully by clamping to 0', () => {
      expect(calculateMatchmakingWindow(-5)).toBe(100);
    });
  });

  describe('isRatingWithinWindow', () => {
    it('returns true when rating diff is within both windows', () => {
      expect(isRatingWithinWindow(1500, 1550, 100, 100)).toBe(true);
      expect(isRatingWithinWindow(1550, 1500, 100, 100)).toBe(true);
    });

    it('returns false when rating diff exceeds either window', () => {
      // Diff is 150; windowA allows 200, but windowB only allows 100
      expect(isRatingWithinWindow(1500, 1650, 200, 100)).toBe(false);
      expect(isRatingWithinWindow(1500, 1650, 100, 200)).toBe(false);
    });

    it('returns true when diff matches exactly the minimum window', () => {
      expect(isRatingWithinWindow(1200, 1300, 100, 150)).toBe(true);
    });
  });

  describe('generateRoomCode', () => {
    it('generates a 6-character code by default', () => {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
    });

    it('respects custom code length', () => {
      expect(generateRoomCode(8)).toHaveLength(8);
      expect(generateRoomCode(4)).toHaveLength(4);
    });

    it('only contains characters from ROOM_CODE_ALPHABET (no 0, O, 1, I, L)', () => {
      const alphabetSet = new Set(ROOM_CODE_ALPHABET.split(''));
      const excludedChars = new Set(['0', 'O', '1', 'I', 'L']);

      for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();
        for (const char of code) {
          expect(alphabetSet.has(char)).toBe(true);
          expect(excludedChars.has(char)).toBe(false);
        }
      }
    });

    it('produces distinct codes over multiple generations', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateRoomCode());
      }
      expect(codes.size).toBe(100);
    });
  });
});
