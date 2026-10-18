import type { Redis } from '../db/redis';
import type { Logger } from './logger';

export interface LeaderLockOptions {
  redis: Redis;
  lockKey?: string;
  instanceId: string;
  ttlMs: number;
  renewMs: number;
  logger: Logger;
  onAcquired?: () => void | Promise<void>;
  onLost?: () => void | Promise<void>;
}

const RENEW_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class LeaderLock {
  private readonly redis: Redis;
  private readonly lockKey: string;
  private readonly instanceId: string;
  private readonly ttlMs: number;
  private readonly renewMs: number;
  private readonly logger: Logger;
  private readonly onAcquired?: () => void | Promise<void>;
  private readonly onLost?: () => void | Promise<void>;

  private isCurrentlyLeader = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private electionTimer?: NodeJS.Timeout;
  private isDestroyed = false;

  constructor(options: LeaderLockOptions) {
    this.redis = options.redis;
    this.lockKey = options.lockKey ?? 'lock:leader';
    this.instanceId = options.instanceId;
    this.ttlMs = options.ttlMs;
    this.renewMs = options.renewMs;
    this.logger = options.logger;
    this.onAcquired = options.onAcquired;
    this.onLost = options.onLost;
  }

  public isLeader(): boolean {
    return this.isCurrentlyLeader;
  }

  public async acquire(): Promise<boolean> {
    if (this.isDestroyed) return false;

    try {
      const res = await this.redis.set(this.lockKey, this.instanceId, 'PX', this.ttlMs, 'NX');
      if (res === 'OK') {
        if (!this.isCurrentlyLeader) {
          this.isCurrentlyLeader = true;
          this.logger.info({ instanceId: this.instanceId }, 'Leader lock acquired');
          this.startHeartbeat();
          try {
            await this.onAcquired?.();
          } catch (err) {
            this.logger.error({ err }, 'Error in onAcquired leader callback');
          }
        }
        return true;
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to acquire leader lock');
    }

    return false;
  }

  public async renew(): Promise<boolean> {
    if (!this.isCurrentlyLeader || this.isDestroyed) return false;

    try {
      const res = await this.redis.eval(RENEW_LUA, 1, this.lockKey, this.instanceId, this.ttlMs);
      if (res === 1) {
        return true;
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to renew leader lock');
    }

    // Lock lost or renewal failed
    await this.handleLost();
    return false;
  }

  public async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.isCurrentlyLeader) return;

    this.isCurrentlyLeader = false;
    try {
      await this.redis.eval(RELEASE_LUA, 1, this.lockKey, this.instanceId);
      this.logger.info({ instanceId: this.instanceId }, 'Leader lock released');
    } catch (err) {
      this.logger.warn({ err }, 'Error releasing leader lock');
    }

    try {
      await this.onLost?.();
    } catch (err) {
      this.logger.error({ err }, 'Error in onLost leader callback');
    }
  }

  public startElection(retryIntervalMs = this.renewMs): void {
    if (this.electionTimer) return;

    const tick = async () => {
      if (this.isDestroyed) return;
      if (this.isCurrentlyLeader) {
        await this.renew();
      } else {
        await this.acquire();
      }
    };

    // Initial attempt immediately
    void tick();
    this.electionTimer = setInterval(() => {
      void tick();
    }, retryIntervalMs);
  }

  public async stop(): Promise<void> {
    this.isDestroyed = true;
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
      this.electionTimer = undefined;
    }
    await this.release();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.renew();
    }, this.renewMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async handleLost(): Promise<void> {
    if (!this.isCurrentlyLeader) return;
    this.isCurrentlyLeader = false;
    this.stopHeartbeat();
    this.logger.warn({ instanceId: this.instanceId }, 'Leader lock lost');
    try {
      await this.onLost?.();
    } catch (err) {
      this.logger.error({ err }, 'Error in onLost leader callback');
    }
  }
}
