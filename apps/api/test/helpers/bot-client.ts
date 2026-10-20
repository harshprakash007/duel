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

  private async emitWithAck<T>(event: string, data?: unknown, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ack on "${event}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const callback = (res: T) => {
        clearTimeout(timer);
        resolve(res);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = this.socket as any;
      if (data !== undefined) {
        s.emit(event, data, callback);
      } else {
        s.emit(event, callback);
      }
    });
  }

  public async ready(): Promise<{ ok: boolean; error?: string }> {
    return this.emitWithAck('match:ready');
  }

  public async submitHint(): Promise<{ ok: boolean; error?: string }> {
    return this.emitWithAck('match:submitted');
  }

  public async resign(): Promise<{ ok: boolean; error?: string }> {
    return this.emitWithAck('match:resign');
  }

  public async rejoin(): Promise<{ ok: boolean; snapshot?: MatchStateSnapshot; error?: string }> {
    return this.emitWithAck('match:rejoin');
  }

  public async joinQueue(sheetSlug: string): Promise<{ ok: boolean; error?: string }> {
    return this.emitWithAck('queue:join', { sheetSlug });
  }

  public async leaveQueue(): Promise<{ ok: boolean }> {
    return this.emitWithAck('queue:leave');
  }

  public async createRoom(
    sheetSlug: string,
    questionCount?: number,
  ): Promise<{ ok: boolean; roomCode?: string; error?: string }> {
    return this.emitWithAck('room:create', { sheetSlug, questionCount });
  }

  public async joinRoom(
    roomCode: string,
  ): Promise<{ ok: boolean; matchId?: string; error?: string }> {
    return this.emitWithAck('room:join', { roomCode });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }
}
