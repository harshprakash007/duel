export interface QueueTicket {
  userId: string;
  handle: string;
  handleNorm: string;
  rating: number;
  sheetId: string;
  sheetSlug: string;
  enqueuedAtMs: number;
}

export interface PrivateRoomData {
  roomCode: string;
  creatorUserId: string;
  sheetId: string;
  sheetSlug: string;
  questionCount: number;
  createdAtMs: number;
}

/**
 * Atomic Lua script to pair two tickets from a sheet queue:
 * KEYS[1]: mm:queue:{sheetId}
 * KEYS[2]: mm:ticket:{userIdA}
 * KEYS[3]: mm:ticket:{userIdB}
 * KEYS[4]: active:{userIdA}
 * KEYS[5]: active:{userIdB}
 * ARGV[1]: userIdA
 * ARGV[2]: userIdB
 * ARGV[3]: activeValue (e.g. 'match:pending')
 * ARGV[4]: activeTtlSec (e.g. 86400)
 *
 * Returns 1 if both tickets were present and successfully claimed; 0 otherwise.
 */
export const PAIR_TICKETS_LUA = `
local scoreA = redis.call('ZSCORE', KEYS[1], ARGV[1])
local scoreB = redis.call('ZSCORE', KEYS[1], ARGV[2])
if not scoreA or not scoreB then
  return 0
end

redis.call('ZREM', KEYS[1], ARGV[1], ARGV[2])
redis.call('DEL', KEYS[2], KEYS[3])
redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
redis.call('SET', KEYS[5], ARGV[3], 'EX', ARGV[4])

return 1
`;
