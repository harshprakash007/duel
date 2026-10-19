import {
  MATCHMAKING_DEFAULTS,
  ROOM_CODE_ALPHABET,
  type MatchmakingWindowParams,
} from './constants';

/**
 * Calculates the expanding rating difference window based on wait time (blueprint §9).
 *
 * @param waitSec Number of seconds the ticket has been waiting in queue
 * @param params Matchmaking window configuration parameters
 * @returns Rating window in points
 */
export function calculateMatchmakingWindow(
  waitSec: number,
  params: MatchmakingWindowParams = MATCHMAKING_DEFAULTS.window,
): number {
  const safeWait = Math.max(0, waitSec);
  const steps = Math.floor(safeWait / params.stepEverySec);
  const rawWindow = params.base + steps * params.step;
  return Math.min(rawWindow, params.max);
}

/**
 * Determines whether two players' ratings satisfy the mutual rating window constraint.
 * Both players must accept the rating difference for a match to form.
 */
export function isRatingWithinWindow(
  ratingA: number,
  ratingB: number,
  windowA: number,
  windowB: number,
): boolean {
  const diff = Math.abs(ratingA - ratingB);
  return diff <= Math.min(windowA, windowB);
}

/**
 * Generates an unambiguous random alphanumeric room code (blueprint §9).
 * Omits ambiguous characters (0, O, 1, I, L).
 */
export function generateRoomCode(length: number = MATCHMAKING_DEFAULTS.roomCodeLength): string {
  let result = '';
  const alphabet = ROOM_CODE_ALPHABET;
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * alphabet.length);
    result += alphabet[idx];
  }
  return result;
}
