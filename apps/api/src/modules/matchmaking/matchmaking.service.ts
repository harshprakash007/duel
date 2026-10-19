import type { Db } from '../../db/prisma';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import type { MatchEngine } from '../match/match-engine';
import { type MatchEngineEmitter, toMatchStateSnapshot } from '../match/match-engine.types';
import { calculateMatchmakingWindow, generateRoomCode, isRatingWithinWindow } from '@duel/shared';
import { PAIR_TICKETS_LUA, type PrivateRoomData, type QueueTicket } from './matchmaking.types';

export class MatchmakingService {
  private isRunning = false;
  private isTickBusy = false;
  private isStatusBusy = false;
  private tickTimer?: NodeJS.Timeout;
  private statusTimer?: NodeJS.Timeout;
  private pendingNoShowTimers = new Set<NodeJS.Timeout>();
  private emitter?: MatchEngineEmitter;

  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
    private readonly matchEngine: MatchEngine,
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly callbacks?: {
      onSolvedSync?: (userId: string, handle: string) => Promise<void>;
    },
  ) {}

  public setEmitter(emitter: MatchEngineEmitter): void {
    this.emitter = emitter;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('Starting matchmaking service');

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.matchmaking.tickMs);

    this.statusTimer = setInterval(() => {
      void this.broadcastQueueStatus();
    }, this.config.matchmaking.statusIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
    for (const t of this.pendingNoShowTimers) {
      clearTimeout(t);
    }
    this.pendingNoShowTimers.clear();
    this.logger.info('Stopped matchmaking service');
  }

  private async checkAndClearStaleActive(userId: string): Promise<string | null> {
    let active = await this.redis.get(`active:${userId}`);
    if (active) {
      if (active.startsWith('match:')) {
        const matchId = active.slice('match:'.length);
        const match = this.matchEngine.getActiveMatch(matchId);
        if (!match || match.status === 'FINISHED' || match.status === 'ABORTED') {
          await this.redis.del(`active:${userId}`);
          active = null;
        }
      } else if (active.startsWith('room:')) {
        const roomCode = active.slice('room:'.length);
        const exists = await this.redis.exists(`room:${roomCode}`);
        if (!exists) {
          await this.redis.del(`active:${userId}`);
          active = null;
        }
      } else if (active.startsWith('queue:')) {
        const exists = await this.redis.exists(`mm:ticket:${userId}`);
        if (!exists) {
          await this.redis.del(`active:${userId}`);
          active = null;
        }
      }
    }
    return active;
  }

  /**
   * Enqueues a user for ranked matchmaking on the specified level sheet.
   */
  public async joinQueue(
    userId: string,
    sheetSlug: string,
    overrideEnqueuedAtMs?: number,
  ): Promise<{ ok: boolean; error?: string }> {
    // 1. Single activity check
    const active = await this.checkAndClearStaleActive(userId);
    if (active) {
      return { ok: false, error: 'User is already in an active queue, room, or match' };
    }

    // 2. Load user & verified handle
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { handle: true, rating: true },
    });

    if (!user?.handle || !user.handle.verifiedAt) {
      return {
        ok: false,
        error: 'You must link and verify a Codeforces handle before queuing for matches',
      };
    }

    // 3. Load active level sheet
    const sheet = await this.db.levelSheet.findUnique({
      where: { slug: sheetSlug },
    });

    if (!sheet || !sheet.isActive) {
      return { ok: false, error: 'Level sheet not found or is currently inactive' };
    }

    const rating = user.rating?.rating ?? this.config.ratingInit.fallback;
    const now = overrideEnqueuedAtMs ?? Date.now();

    const ticket: QueueTicket = {
      userId,
      handle: user.handle.handle,
      handleNorm: user.handle.handleNorm,
      rating,
      sheetId: sheet.id,
      sheetSlug: sheet.slug,
      enqueuedAtMs: now,
    };

    // 4. Save ticket and queue membership in Redis
    await this.redis
      .multi()
      .set(`active:${userId}`, `queue:${sheet.id}`, 'EX', 86400)
      .set(`mm:ticket:${userId}`, JSON.stringify(ticket), 'EX', 86400)
      .zadd(`mm:queue:${sheet.id}`, now, userId)
      .exec();

    this.logger.info(
      { userId, handle: ticket.handle, sheetSlug, rating },
      'User enqueued for matchmaking',
    );

    // 5. Trigger background solved-set crawler if configured
    if (this.callbacks?.onSolvedSync) {
      void this.callbacks.onSolvedSync(userId, ticket.handle).catch((err) => {
        this.logger.warn({ err, userId }, 'Background solved-set sync failed on queue join');
      });
    }

    return { ok: true };
  }

  /**
   * Cancels a user's queued ticket.
   */
  public async leaveQueue(userId: string): Promise<{ ok: boolean }> {
    const active = await this.redis.get(`active:${userId}`);
    if (active && active.startsWith('room:')) {
      const roomCode = active.slice('room:'.length);
      await this.redis.del(`room:${roomCode}`);
      await this.redis.del(`active:${userId}`);
    }

    const ticketRaw = await this.redis.get(`mm:ticket:${userId}`);
    if (ticketRaw) {
      try {
        const ticket = JSON.parse(ticketRaw) as QueueTicket;
        await this.redis.zrem(`mm:queue:${ticket.sheetId}`, userId);
      } catch {
        // ignore JSON parse error
      }
      await this.redis.del(`mm:ticket:${userId}`);
    }

    // Clear active pointer if it points to a queue
    if (active && active.startsWith('queue:')) {
      await this.redis.del(`active:${userId}`);
    }

    this.logger.info({ userId }, 'User left matchmaking queue');
    return { ok: true };
  }

  /**
   * Creates a private custom room with a 6-character room code.
   */
  public async createRoom(
    userId: string,
    sheetSlug: string,
    questionCount?: number,
  ): Promise<{ ok: boolean; roomCode?: string; error?: string }> {
    const active = await this.checkAndClearStaleActive(userId);
    if (active) {
      return { ok: false, error: 'User is already in an active queue, room, or match' };
    }

    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { handle: true },
    });

    if (!user?.handle || !user.handle.verifiedAt) {
      return {
        ok: false,
        error: 'You must link and verify a Codeforces handle before creating rooms',
      };
    }

    const sheet = await this.db.levelSheet.findUnique({
      where: { slug: sheetSlug },
    });

    if (!sheet || !sheet.isActive) {
      return { ok: false, error: 'Level sheet not found or inactive' };
    }

    const qCount = Math.min(
      this.config.match.questionCountMax,
      Math.max(this.config.match.questionCountMin, questionCount ?? sheet.questionCount),
    );

    const roomCode = generateRoomCode(this.config.matchmaking.roomCodeLength);
    const roomTtlSec = Math.floor(this.config.matchmaking.roomTtlMs / 1000);

    const roomData: PrivateRoomData = {
      roomCode,
      creatorUserId: userId,
      sheetId: sheet.id,
      sheetSlug: sheet.slug,
      questionCount: qCount,
      createdAtMs: Date.now(),
    };

    await this.redis
      .multi()
      .set(`active:${userId}`, `room:${roomCode}`, 'EX', roomTtlSec)
      .set(`room:${roomCode}`, JSON.stringify(roomData), 'EX', roomTtlSec)
      .exec();

    this.logger.info(
      { userId, roomCode, sheetSlug, questionCount: qCount },
      'Private room created',
    );
    return { ok: true, roomCode };
  }

  /**
   * Joins a private custom room and initiates the private match in LOBBY.
   */
  public async joinRoom(
    userId: string,
    rawCode: string,
  ): Promise<{ ok: boolean; matchId?: string; error?: string }> {
    const roomCode = rawCode.trim().toUpperCase();

    const active = await this.checkAndClearStaleActive(userId);
    if (active) {
      return { ok: false, error: 'User is already in an active queue, room, or match' };
    }

    const roomRaw = await this.redis.get(`room:${roomCode}`);
    if (!roomRaw) {
      return { ok: false, error: 'Room not found or has expired' };
    }

    const room = JSON.parse(roomRaw) as PrivateRoomData;
    if (room.creatorUserId === userId) {
      return { ok: false, error: 'Cannot join your own room' };
    }

    const [creator, joiner] = await Promise.all([
      this.db.user.findUnique({
        where: { id: room.creatorUserId },
        include: { handle: true, rating: true },
      }),
      this.db.user.findUnique({
        where: { id: userId },
        include: { handle: true, rating: true },
      }),
    ]);

    if (!joiner?.handle || !joiner.handle.verifiedAt) {
      return {
        ok: false,
        error: 'You must link and verify a Codeforces handle before joining rooms',
      };
    }

    if (!creator?.handle || !creator.handle.verifiedAt) {
      return { ok: false, error: 'Room creator handle is no longer valid' };
    }

    // Delete room from Redis
    await this.redis.del(`room:${roomCode}`);

    // Create private match via MatchEngine
    const match = await this.matchEngine.createMatch({
      sheetId: room.sheetId,
      mode: 'PRIVATE',
      roomCode,
      questionCount: room.questionCount,
      players: [
        {
          userId: creator.id,
          handle: creator.handle.handle,
          handleNorm: creator.handle.handleNorm,
          rating: creator.rating?.rating ?? this.config.ratingInit.fallback,
        },
        {
          userId: joiner.id,
          handle: joiner.handle.handle,
          handleNorm: joiner.handle.handleNorm,
          rating: joiner.rating?.rating ?? this.config.ratingInit.fallback,
        },
      ],
    });

    // Update active pointers to match
    await this.redis
      .multi()
      .set(`active:${creator.id}`, `match:${match.matchId}`, 'EX', 86400)
      .set(`active:${joiner.id}`, `match:${match.matchId}`, 'EX', 86400)
      .exec();

    const now = Date.now();

    // Emit match:found to creator and joiner
    this.emitter?.emitToUser(creator.id, 'match:found', {
      matchId: match.matchId,
      opponent: {
        userId: joiner.id,
        handle: joiner.handle.handle,
        rating: joiner.rating?.rating ?? this.config.ratingInit.fallback,
      },
      serverNow: now,
    });

    this.emitter?.emitToUser(joiner.id, 'match:found', {
      matchId: match.matchId,
      opponent: {
        userId: creator.id,
        handle: creator.handle.handle,
        rating: creator.rating?.rating ?? this.config.ratingInit.fallback,
      },
      serverNow: now,
    });

    const snapshot = toMatchStateSnapshot(match);
    this.emitter?.emitToUser(creator.id, 'match:state', snapshot);
    this.emitter?.emitToUser(joiner.id, 'match:state', snapshot);

    this.logger.info(
      { matchId: match.matchId, roomCode, creator: creator.id, joiner: joiner.id },
      'Private room matched and match created in LOBBY',
    );

    return { ok: true, matchId: match.matchId };
  }

  /**
   * Retrieves a player's recent opponent IDs from their last N matches.
   */
  public async getRecentOpponentIds(userId: string, count = 3): Promise<Set<string>> {
    const recentMatches = await this.db.matchPlayer.findMany({
      where: { userId },
      orderBy: { match: { createdAt: 'desc' } },
      take: count,
      select: { matchId: true },
    });

    const matchIds = recentMatches.map((m) => m.matchId);
    if (matchIds.length === 0) return new Set();

    const opponents = await this.db.matchPlayer.findMany({
      where: {
        matchId: { in: matchIds },
        userId: { not: userId },
      },
      select: { userId: true },
    });

    return new Set(opponents.map((p) => p.userId));
  }

  /**
   * Evaluates queued tickets and forms pairings (leader only, every 1 s).
   */
  public async tick(): Promise<void> {
    if (this.isTickBusy) return;
    this.isTickBusy = true;

    try {
      const sheets = await this.db.levelSheet.findMany({
        where: { isActive: true },
        select: { id: true, slug: true },
      });

      const now = Date.now();

      for (const sheet of sheets) {
        const queueKey = `mm:queue:${sheet.id}`;
        const userIds = await this.redis.zrangebyscore(queueKey, '-inf', '+inf');
        if (userIds.length < 2) continue;

        // Fetch ticket data
        const ticketKeys = userIds.map((id) => `mm:ticket:${id}`);
        const rawTickets = await this.redis.mget(...ticketKeys);

        const tickets: QueueTicket[] = [];
        for (const raw of rawTickets) {
          if (raw) {
            try {
              tickets.push(JSON.parse(raw) as QueueTicket);
            } catch {
              // ignore invalid ticket JSON
            }
          }
        }

        // Sort ascending by enqueue time (oldest first)
        tickets.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);

        const matchedThisTick = new Set<string>();

        for (let i = 0; i < tickets.length; i++) {
          const ticketA = tickets[i]!;
          if (matchedThisTick.has(ticketA.userId)) continue;

          const waitSecA = (now - ticketA.enqueuedAtMs) / 1000;
          const windowA = calculateMatchmakingWindow(waitSecA, this.config.matchmaking.window);

          let bestPartner: QueueTicket | null = null;
          let bestDiff = Infinity;

          // Fetch recent opponents for player A
          const waiveRecent = waitSecA >= this.config.matchmaking.recentOpponentWaiveMs / 1000;
          let recentOpponentsA: Set<string> | null = null;
          if (!waiveRecent) {
            recentOpponentsA = await this.getRecentOpponentIds(
              ticketA.userId,
              this.config.matchmaking.recentOpponentCount,
            );
          }

          for (let j = i + 1; j < tickets.length; j++) {
            const ticketB = tickets[j]!;
            if (matchedThisTick.has(ticketB.userId)) continue;

            // Check recent opponent filter
            if (recentOpponentsA && recentOpponentsA.has(ticketB.userId)) {
              continue;
            }

            const waitSecB = (now - ticketB.enqueuedAtMs) / 1000;
            const windowB = calculateMatchmakingWindow(waitSecB, this.config.matchmaking.window);

            if (isRatingWithinWindow(ticketA.rating, ticketB.rating, windowA, windowB)) {
              const diff = Math.abs(ticketA.rating - ticketB.rating);
              if (diff < bestDiff) {
                bestDiff = diff;
                bestPartner = ticketB;
              }
            }
          }

          if (bestPartner) {
            const partnerB = bestPartner;
            // Execute atomic pairing Lua script
            const res = await this.redis.eval(
              PAIR_TICKETS_LUA,
              5,
              queueKey,
              `mm:ticket:${ticketA.userId}`,
              `mm:ticket:${partnerB.userId}`,
              `active:${ticketA.userId}`,
              `active:${partnerB.userId}`,
              ticketA.userId,
              partnerB.userId,
              'match:pending',
              86400,
            );

            if (res === 1) {
              matchedThisTick.add(ticketA.userId);
              matchedThisTick.add(partnerB.userId);

              try {
                // Create ranked match via MatchEngine
                const match = await this.matchEngine.createMatch({
                  sheetId: sheet.id,
                  mode: 'RANKED',
                  players: [
                    {
                      userId: ticketA.userId,
                      handle: ticketA.handle,
                      handleNorm: ticketA.handleNorm,
                      rating: ticketA.rating,
                    },
                    {
                      userId: partnerB.userId,
                      handle: partnerB.handle,
                      handleNorm: partnerB.handleNorm,
                      rating: partnerB.rating,
                    },
                  ],
                });

                // Update active pointers with match ID
                await this.redis
                  .multi()
                  .set(`active:${ticketA.userId}`, `match:${match.matchId}`, 'EX', 86400)
                  .set(`active:${partnerB.userId}`, `match:${match.matchId}`, 'EX', 86400)
                  .exec();

                // Notify both players
                this.emitter?.emitToUser(ticketA.userId, 'match:found', {
                  matchId: match.matchId,
                  opponent: {
                    userId: partnerB.userId,
                    handle: partnerB.handle,
                    rating: partnerB.rating,
                  },
                  serverNow: now,
                });

                this.emitter?.emitToUser(partnerB.userId, 'match:found', {
                  matchId: match.matchId,
                  opponent: {
                    userId: ticketA.userId,
                    handle: ticketA.handle,
                    rating: ticketA.rating,
                  },
                  serverNow: now,
                });

                const snapshot = toMatchStateSnapshot(match);
                this.emitter?.emitToUser(ticketA.userId, 'match:state', snapshot);
                this.emitter?.emitToUser(partnerB.userId, 'match:state', snapshot);

                this.logger.info(
                  {
                    matchId: match.matchId,
                    playerA: ticketA.userId,
                    playerB: partnerB.userId,
                    diff: bestDiff,
                  },
                  'Paired players and created ranked match',
                );

                // Arm No-Show presence check (§9: 20s)
                this.armNoShowCheck(match.matchId, ticketA, partnerB);
              } catch (err) {
                this.logger.error(
                  { err, playerA: ticketA.userId, playerB: partnerB.userId },
                  'Failed to create match from paired tickets',
                );
              }
            }
          }
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Error during matchmaking tick loop');
    } finally {
      this.isTickBusy = false;
    }
  }

  /**
   * Broadcasts queue status (waitedMs, window) to all queued players (every 2 s).
   */
  public async broadcastQueueStatus(): Promise<void> {
    if (this.isStatusBusy || !this.emitter) return;
    this.isStatusBusy = true;

    try {
      const sheets = await this.db.levelSheet.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      const now = Date.now();

      for (const sheet of sheets) {
        const userIds = await this.redis.zrangebyscore(`mm:queue:${sheet.id}`, '-inf', '+inf');
        if (userIds.length === 0) continue;

        const ticketKeys = userIds.map((id) => `mm:ticket:${id}`);
        const rawTickets = await this.redis.mget(...ticketKeys);

        for (const raw of rawTickets) {
          if (raw) {
            try {
              const ticket = JSON.parse(raw) as QueueTicket;
              const waitedMs = Math.max(0, now - ticket.enqueuedAtMs);
              const window = calculateMatchmakingWindow(
                waitedMs / 1000,
                this.config.matchmaking.window,
              );

              this.emitter.emitToUser(ticket.userId, 'queue:status', {
                waitedMs,
                window,
                serverNow: now,
              });
            } catch {
              // ignore invalid ticket JSON
            }
          }
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Error broadcasting queue status');
    } finally {
      this.isStatusBusy = false;
    }
  }

  /**
   * Arms a 20s no-show timer (§9): if both players aren't connected, aborts match and requeues whoever is present.
   */
  private armNoShowCheck(matchId: string, ticketA: QueueTicket, ticketB: QueueTicket): void {
    const timer = setTimeout(async () => {
      this.pendingNoShowTimers.delete(timer);
      try {
        const match = this.matchEngine.getActiveMatch(matchId);
        if (!match || match.status === 'FINISHED' || match.status === 'ABORTED') {
          return;
        }

        const pA = match.players[ticketA.userId];
        const pB = match.players[ticketB.userId];

        const connectedA = pA?.connected ?? false;
        const connectedB = pB?.connected ?? false;

        // If either player never connected / is not present
        if (!connectedA || !connectedB) {
          this.logger.warn(
            { matchId, connectedA, connectedB },
            'No-show timeout triggered: aborting match',
          );

          await this.matchEngine.finishMatch(matchId, 'ABORT_NO_SHOW');

          // Requeue whichever player is present, preserving original enqueue timestamp
          if (connectedA && !connectedB) {
            await this.joinQueue(ticketA.userId, ticketA.sheetSlug, ticketA.enqueuedAtMs);
          } else if (connectedB && !connectedA) {
            await this.joinQueue(ticketB.userId, ticketB.sheetSlug, ticketB.enqueuedAtMs);
          }
        }
      } catch (err) {
        this.logger.error({ err, matchId }, 'Error executing no-show check');
      }
    }, this.config.match.noShowTimeoutMs);

    this.pendingNoShowTimers.add(timer);
  }
}
