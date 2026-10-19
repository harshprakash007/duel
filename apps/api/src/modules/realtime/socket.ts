import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from '../../db/redis';
import type { Config } from '../../config/index';
import type { Logger } from '../../lib/logger';
import { verifyAuthToken } from '../auth/jwt';
import type { MatchEngine } from '../match/match-engine';
import { toMatchStateSnapshot } from '../match/match-engine.types';
import type { PollerService } from '../poller/poller.service';
import type { MatchmakingService } from '../matchmaking/matchmaking.service';
import type { Metrics } from '../../lib/metrics';
import type { ClientToServerEvents, ServerToClientEvents } from '@duel/shared';

export interface SocketData {
  userId: string;
  email: string;
  role: string;
}

export interface SocketServerInstance {
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  close: () => Promise<void>;
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

function extractToken(socket: Socket, cookieName: string): string | undefined {
  if (typeof socket.handshake.auth?.token === 'string') {
    return socket.handshake.auth.token;
  }
  const authHeader = socket.handshake.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return parseCookie(socket.handshake.headers.cookie, cookieName);
}

export function createSocketServer(params: {
  httpServer: HttpServer;
  redis: Redis;
  config: Config;
  logger: Logger;
  matchEngine: MatchEngine;
  pollerService: PollerService;
  matchmakingService?: MatchmakingService;
  metrics?: Metrics;
}): SocketServerInstance {
  const {
    httpServer,
    redis,
    config,
    logger,
    matchEngine,
    pollerService,
    matchmakingService,
    metrics,
  } = params;

  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  pubClient.on('error', (err) => {
    logger.debug({ err }, 'Redis pubClient error');
  });
  subClient.on('error', (err) => {
    logger.debug({ err }, 'Redis subClient error');
  });

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: config.http.corsOrigins,
      credentials: true,
    },
    adapter: createAdapter(pubClient, subClient),
  });

  // Wire MatchEngine & MatchmakingService emitters to Socket.IO
  const emitter = {
    emitToMatch: (matchId: string, event: string, data: unknown) => {
      io.to(`match:${matchId}`).emit(event as keyof ServerToClientEvents, data as never);
    },
    emitToUser: (userId: string, event: string, data: unknown) => {
      io.to(`user:${userId}`).emit(event as keyof ServerToClientEvents, data as never);
      if (
        event === 'match:found' &&
        typeof data === 'object' &&
        data !== null &&
        'matchId' in data
      ) {
        const matchId = (data as { matchId: string }).matchId;
        const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`);
        const hasConnectedSockets = userRoom !== undefined && userRoom.size > 0;
        if (hasConnectedSockets) {
          void io.in(`user:${userId}`).socketsJoin(`match:${matchId}`);
          const activeMatch = matchEngine.getActiveMatch(matchId);
          if (activeMatch && activeMatch.players[userId]) {
            activeMatch.players[userId].connected = true;
          }
        }
      }
    },
  };

  matchEngine.setEmitter(emitter);
  matchmakingService?.setEmitter(emitter);

  // Authentication handshake middleware
  io.use((socket, next) => {
    const token = extractToken(socket, config.auth.cookieName);
    if (!token) {
      return next(new Error('unauthorized: missing token'));
    }

    const payload = verifyAuthToken(token, config.auth.jwtSecret);
    if (!payload) {
      return next(new Error('unauthorized: invalid token'));
    }

    socket.data = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  });

  io.on('connection', async (socket) => {
    metrics?.activeSockets.inc();
    const { userId } = socket.data;
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');

    socket.join(`user:${userId}`);

    // If player has an active match, join room and send snapshot
    try {
      const match = await matchEngine.getActiveMatchForUser(userId);
      if (match) {
        socket.join(`match:${match.matchId}`);
        if (match.players[userId]) {
          match.players[userId].connected = true;
        }
        socket.emit('match:state', toMatchStateSnapshot(match));
      }
    } catch (err) {
      logger.error({ err, userId }, 'Error checking active match on connect');
    }

    socket.on('disconnect', async () => {
      metrics?.activeSockets.dec();
      logger.debug({ userId, socketId: socket.id }, 'Socket disconnected');
      try {
        const match = await matchEngine.getActiveMatchForUser(userId);
        if (match && match.players[userId]) {
          match.players[userId].connected = false;
        }
      } catch (err) {
        logger.error({ err, userId }, 'Error updating player disconnect status');
      }

      // If user was queued, remove ticket on disconnect
      try {
        const active = await redis.get(`active:${userId}`);
        if (active && active.startsWith('queue:')) {
          await matchmakingService?.leaveQueue(userId);
        }
      } catch (err) {
        logger.error({ err, userId }, 'Error removing queued user on disconnect');
      }
    });

    socket.on('match:ready', async (ack) => {
      try {
        const activeMatch = await matchEngine.getActiveMatchForUser(userId);
        if (!activeMatch) {
          return ack({ ok: false, error: 'No active match found' });
        }
        socket.join(`match:${activeMatch.matchId}`);
        if (activeMatch.players[userId]) {
          activeMatch.players[userId].connected = true;
        }
        const ok = await matchEngine.playerReady(activeMatch.matchId, userId);
        ack({ ok });
      } catch (err: unknown) {
        ack({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to acknowledge ready',
        });
      }
    });

    socket.on('match:submitted', async (ack) => {
      try {
        const activeMatch = await matchEngine.getActiveMatchForUser(userId);
        if (!activeMatch) {
          return ack({ ok: false, error: 'No active match found' });
        }
        const player = activeMatch.players[userId];
        if (!player) {
          return ack({ ok: false, error: 'Player not in match' });
        }
        const triggered = await pollerService.hint(userId, player.handleNorm);
        ack({ ok: triggered });
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit hint' });
      }
    });

    socket.on('match:resign', async (ack) => {
      try {
        const activeMatch = await matchEngine.getActiveMatchForUser(userId);
        if (!activeMatch) {
          return ack({ ok: false, error: 'No active match found' });
        }
        const ok = await matchEngine.resign(activeMatch.matchId, userId);
        ack({ ok });
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to resign' });
      }
    });

    socket.on('match:rejoin', async (ack) => {
      try {
        const activeMatch = await matchEngine.getActiveMatchForUser(userId);
        if (!activeMatch) {
          return ack({ ok: false, error: 'No active match found' });
        }
        socket.join(`match:${activeMatch.matchId}`);
        if (activeMatch.players[userId]) {
          activeMatch.players[userId].connected = true;
        }
        ack({ ok: true, snapshot: toMatchStateSnapshot(activeMatch) });
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to rejoin' });
      }
    });

    socket.on('queue:join', async (data, ack) => {
      if (!matchmakingService) {
        return ack({ ok: false, error: 'Matchmaking service not available' });
      }
      try {
        const res = await matchmakingService.joinQueue(userId, data.sheetSlug);
        ack(res);
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to join queue' });
      }
    });

    socket.on('queue:leave', async (ack) => {
      if (!matchmakingService) {
        return ack({ ok: true });
      }
      try {
        const res = await matchmakingService.leaveQueue(userId);
        ack(res);
      } catch {
        ack({ ok: false });
      }
    });

    socket.on('room:create', async (data, ack) => {
      if (!matchmakingService) {
        return ack({ ok: false, error: 'Matchmaking service not available' });
      }
      try {
        const res = await matchmakingService.createRoom(userId, data.sheetSlug, data.questionCount);
        ack(res);
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to create room' });
      }
    });

    socket.on('room:join', async (data, ack) => {
      if (!matchmakingService) {
        return ack({ ok: false, error: 'Matchmaking service not available' });
      }
      try {
        const res = await matchmakingService.joinRoom(userId, data.roomCode);
        ack(res);
      } catch (err: unknown) {
        ack({ ok: false, error: err instanceof Error ? err.message : 'Failed to join room' });
      }
    });
  });

  return {
    io,
    close: async () => {
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      // Allow adapter unsubscribe commands to complete cleanly with Redis
      await new Promise((resolve) => setTimeout(resolve, 100));
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
      metrics?.activeSockets.set(0);
    },
  };
}
