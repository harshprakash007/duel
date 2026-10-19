import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, MatchStateSnapshot, ServerToClientEvents } from '@duel/shared';

export interface BotClientOptions {
  url: string;
  token: string;
}

export class BotClient {
  public socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private latestState?: MatchStateSnapshot;
  private readonly stateListeners = new Set<(state: MatchStateSnapshot) => void>();
  private readonly eventListeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(options: BotClientOptions) {
    this.socket = io(options.url, {
      auth: { token: options.token },
      transports: ['websocket'],
      forceNew: true,
      autoConnect: false,
    });

    this.socket.on('match:state', (snapshot) => {
      this.latestState = snapshot;
      for (const listener of this.stateListeners) {
        listener(snapshot);
      }
    });

    const standardEvents: Array<keyof ServerToClientEvents> = [
      'match:state',
      'match:found',
      'question:start',
      'question:update',
      'question:end',
      'match:end',
      'system:cf_degraded',
      'system:cf_recovered',
      'queue:status',
      'error',
    ];

    for (const event of standardEvents) {
      this.socket.on(event, ((data: unknown) => {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
          for (const l of listeners) {
            l(data);
          }
        }
      }) as never);
    }
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('BotClient connection timed out'));
      }, 5000);

      this.socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.once('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.socket.connect();
    });
  }

  public getLatestState(): MatchStateSnapshot | undefined {
    return this.latestState;
  }

  public waitForState(
    predicate: (state: MatchStateSnapshot) => boolean,
    timeoutMs = 6000,
  ): Promise<MatchStateSnapshot> {
    if (this.latestState && predicate(this.latestState)) {
      return Promise.resolve(this.latestState);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stateListeners.delete(listener);
        reject(
          new Error(
            `Timed out waiting for state condition. Latest state: ${JSON.stringify(this.latestState)}`,
          ),
        );
      }, timeoutMs);

      const listener = (state: MatchStateSnapshot) => {
        if (predicate(state)) {
          clearTimeout(timeout);
          this.stateListeners.delete(listener);
          resolve(state);
        }
      };

      this.stateListeners.add(listener);
    });
  }

  public waitForEvent<T = unknown>(eventName: string, timeoutMs = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      let listeners = this.eventListeners.get(eventName);
      if (!listeners) {
        listeners = new Set();
        this.eventListeners.set(eventName, listeners);
      }

      const timeout = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`Timed out waiting for event: ${eventName}`));
      }, timeoutMs);

      const listener = (data: unknown) => {
        clearTimeout(timeout);
        listeners.delete(listener);
        resolve(data as T);
      };

      listeners.add(listener);
    });
  }

  public async ready(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('match:ready', (res) => resolve(res));
    });
  }

  public async submitHint(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('match:submitted', (res) => resolve(res));
    });
  }

  public async resign(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('match:resign', (res) => resolve(res));
    });
  }

  public async rejoin(): Promise<{ ok: boolean; snapshot?: MatchStateSnapshot; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('match:rejoin', (res) => resolve(res));
    });
  }

  public async joinQueue(sheetSlug: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('queue:join', { sheetSlug }, (res) => resolve(res));
    });
  }

  public async leaveQueue(): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      this.socket.emit('queue:leave', (res) => resolve(res));
    });
  }

  public async createRoom(
    sheetSlug: string,
    questionCount?: number,
  ): Promise<{ ok: boolean; roomCode?: string; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('room:create', { sheetSlug, questionCount }, (res) => resolve(res));
    });
  }

  public async joinRoom(
    roomCode: string,
  ): Promise<{ ok: boolean; matchId?: string; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit('room:join', { roomCode }, (res) => resolve(res));
    });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }
}
