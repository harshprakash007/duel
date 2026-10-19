import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, MatchStateSnapshot, ServerToClientEvents } from '@duel/shared';
import { useSoundStore } from './sound';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface QueueStatusState {
  inQueue: boolean;
  sheetSlug: string;
  waitedMs: number;
  window: number;
}

export interface ToastNotice {
  id: string;
  message: string;
  type: 'success' | 'penalty' | 'info';
  timestamp: number;
}

interface SocketStoreState {
  socket: TypedSocket | null;
  isConnected: boolean;
  activeMatch: MatchStateSnapshot | null;
  queueStatus: QueueStatusState | null;
  roomCode: string | null;
  cfDegraded: boolean;
  clockDriftMs: number;
  toasts: ToastNotice[];

  // Actions
  connect: () => void;
  disconnect: () => void;
  joinQueue: (sheetSlug: string) => Promise<{ ok: boolean; error?: string }>;
  leaveQueue: () => Promise<{ ok: boolean; error?: string }>;
  createRoom: (
    sheetSlug: string,
    questionCount?: number,
  ) => Promise<{ ok: boolean; roomCode?: string; error?: string }>;
  joinRoom: (roomCode: string) => Promise<{ ok: boolean; matchId?: string; error?: string }>;
  setReady: () => Promise<{ ok: boolean; error?: string }>;
  sendSubmissionHint: () => Promise<{ ok: boolean; error?: string }>;
  resignMatch: () => Promise<{ ok: boolean; error?: string }>;
  rejoinMatch: () => Promise<{ ok: boolean; snapshot?: MatchStateSnapshot; error?: string }>;
  setActiveMatch: (match: MatchStateSnapshot | null) => void;
  clearQueue: () => void;
  removeToast: (id: string) => void;
}

let socketInstance: TypedSocket | null = null;

export const useSocketStore = create<SocketStoreState>((set, get) => ({
  socket: null,
  isConnected: false,
  activeMatch: null,
  queueStatus: null,
  roomCode: null,
  cfDegraded: false,
  clockDriftMs: 0,
  toasts: [],

  connect: () => {
    if (socketInstance?.connected) return;

    if (!socketInstance) {
      socketInstance = io({
        withCredentials: true,
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      const sound = useSoundStore.getState();

      socketInstance.on('connect', () => {
        set({ isConnected: true });
        // Attempt match rejoin if previously engaged
        void get().rejoinMatch();
      });

      socketInstance.on('disconnect', () => {
        set({ isConnected: false });
      });

      socketInstance.on('queue:status', (data) => {
        const drift = data.serverNow - Date.now();
        set((state) => ({
          clockDriftMs: drift,
          queueStatus: state.queueStatus
            ? { ...state.queueStatus, waitedMs: data.waitedMs, window: data.window }
            : null,
        }));
      });

      socketInstance.on('match:found', (data) => {
        sound.play('playMatchFound');
        set({
          queueStatus: null,
          toasts: [
            ...get().toasts,
            {
              id: `found-${Date.now()}`,
              message: `Opponent found! Match starting against ${data.opponent.handle}`,
              type: 'info',
              timestamp: Date.now(),
            },
          ],
        });
      });

      socketInstance.on('match:state', (snapshot) => {
        set({ activeMatch: snapshot });
      });

      socketInstance.on('question:start', (data) => {
        sound.play('playQuestionStart');
        set((state) => {
          if (!state.activeMatch) return state;
          return {
            clockDriftMs: data.serverNow - Date.now(),
            activeMatch: {
              ...state.activeMatch,
              status: 'ACTIVE',
              currentQuestionIdx: data.idx,
              currentProblem: data.problem,
              questionStartedAtMs: data.startedAtMs,
              questionDeadlineMs: data.deadlineAtMs,
              breakDeadlineMs: undefined,
            },
          };
        });
      });

      socketInstance.on('question:update', (data) => {
        const state = get();
        if (data.solved) {
          sound.play('playSolveAccepted');
          set({
            toasts: [
              ...state.toasts,
              {
                id: `solved-${Date.now()}`,
                message: `Question solved!`,
                type: 'success',
                timestamp: Date.now(),
              },
            ],
          });
        } else if (data.wrongAttempts > 0) {
          sound.play('playPenalty');
          set({
            toasts: [
              ...state.toasts,
              {
                id: `penalty-${Date.now()}`,
                message: `Attempt failed (wrong submission penalty applied)`,
                type: 'penalty',
                timestamp: Date.now(),
              },
            ],
          });
        }
      });

      socketInstance.on('question:end', (data) => {
        set((state) => {
          if (!state.activeMatch) return state;
          return {
            clockDriftMs: data.serverNow - Date.now(),
            activeMatch: {
              ...state.activeMatch,
              breakDeadlineMs: data.breakDeadlineMs,
              questionDeadlineMs: undefined,
            },
          };
        });
      });

      socketInstance.on('match:end', (data) => {
        const state = get();
        const currentUserId = state.activeMatch?.players
          ? Object.keys(state.activeMatch.players)[0]
          : undefined;

        if (data.winnerUserId) {
          if (data.winnerUserId === currentUserId) {
            sound.play('playVictory');
          } else {
            sound.play('playDefeat');
          }
        }

        set((s) => {
          if (!s.activeMatch) return s;
          return {
            activeMatch: {
              ...s.activeMatch,
              status: 'FINISHED',
              winnerUserId: data.winnerUserId,
              endReason: data.endReason,
            },
          };
        });
      });

      socketInstance.on('system:cf_degraded', () => {
        set({ cfDegraded: true });
      });

      socketInstance.on('system:cf_recovered', () => {
        set({ cfDegraded: false });
      });

      socketInstance.on('error', (err) => {
        set((state) => ({
          toasts: [
            ...state.toasts,
            {
              id: `err-${Date.now()}`,
              message: err.message,
              type: 'penalty',
              timestamp: Date.now(),
            },
          ],
        }));
      });
    }

    socketInstance.connect();
    set({ socket: socketInstance });
  },

  disconnect: () => {
    if (socketInstance) {
      socketInstance.disconnect();
      set({ isConnected: false });
    }
  },

  joinQueue: async (sheetSlug: string) => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    set({ queueStatus: { inQueue: true, sheetSlug, waitedMs: 0, window: 100 } });

    return new Promise((resolve) => {
      s.emit('queue:join', { sheetSlug }, (res) => {
        if (!res.ok) {
          set({ queueStatus: null });
        }
        resolve(res);
      });
    });
  },

  leaveQueue: async () => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('queue:leave', (res) => {
        if (res.ok) {
          set({ queueStatus: null });
        }
        resolve(res);
      });
    });
  },

  createRoom: async (sheetSlug: string, questionCount?: number) => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('room:create', { sheetSlug, questionCount }, (res) => {
        if (res.ok && res.roomCode) {
          set({ roomCode: res.roomCode });
        }
        resolve(res);
      });
    });
  },

  joinRoom: async (roomCode: string) => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('room:join', { roomCode }, (res) => {
        if (res.ok) {
          set({ roomCode });
        }
        resolve(res);
      });
    });
  },

  setReady: async () => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('match:ready', resolve);
    });
  },

  sendSubmissionHint: async () => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('match:submitted', resolve);
    });
  },

  resignMatch: async () => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('match:resign', resolve);
    });
  },

  rejoinMatch: async () => {
    const s = socketInstance;
    if (!s) return { ok: false, error: 'Socket not connected' };

    return new Promise((resolve) => {
      s.emit('match:rejoin', (res) => {
        if (res.ok && res.snapshot) {
          set({ activeMatch: res.snapshot });
        }
        resolve(res);
      });
    });
  },

  setActiveMatch: (match) => set({ activeMatch: match }),
  clearQueue: () => set({ queueStatus: null }),
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
