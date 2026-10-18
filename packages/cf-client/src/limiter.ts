import type { PriorityLane } from './types';

export interface LimiterOptions {
  maxRps: number;
  agingMs?: number;
  onQueueDepthChange?: (lane: PriorityLane, depth: number) => void;
}

interface QueuedRequest {
  lane: PriorityLane;
  enqueuedAt: number;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

export class PriorityTokenBucket {
  private readonly maxRps: number;
  private readonly intervalMs: number;
  private readonly agingMs: number;
  private readonly queues: Record<PriorityLane, QueuedRequest[]> = {
    high: [],
    normal: [],
    low: [],
  };
  private tokens: number;
  private lastRefillTime: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly onQueueDepthChange?: (lane: PriorityLane, depth: number) => void;

  constructor(options: LimiterOptions) {
    this.maxRps = Math.max(0.1, options.maxRps);
    this.intervalMs = 1000 / this.maxRps;
    this.agingMs = options.agingMs ?? 5000;
    this.tokens = 1; // start with 1 token available
    this.lastRefillTime = Date.now();
    this.onQueueDepthChange = options.onQueueDepthChange;
  }

  public getQueueDepth(lane: PriorityLane): number {
    return this.queues[lane].length;
  }

  public getTotalQueueDepth(): number {
    return this.queues.high.length + this.queues.normal.length + this.queues.low.length;
  }

  public async acquire(lane: PriorityLane = 'normal', signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }

    this.refill();

    // If no queue and token available, consume immediately
    if (this.getTotalQueueDepth() === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const item: QueuedRequest = {
        lane,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      const abortHandler = () => {
        this.removeFromQueue(item);
        reject(signal?.reason ?? new Error('Aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const originalResolve = resolve;
      item.resolve = () => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        originalResolve();
      };

      this.queues[lane].push(item);
      this.notifyQueueChange(lane);
      this.ensureScheduled();
    });
  }

  private removeFromQueue(item: QueuedRequest): void {
    const list = this.queues[item.lane];
    const idx = list.indexOf(item);
    if (idx !== -1) {
      list.splice(idx, 1);
      this.notifyQueueChange(item.lane);
    }
  }

  private notifyQueueChange(lane: PriorityLane): void {
    if (this.onQueueDepthChange) {
      this.onQueueDepthChange(lane, this.queues[lane].length);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const newTokens = elapsed / this.intervalMs;
    if (newTokens >= 1) {
      this.tokens = Math.min(1, this.tokens + newTokens);
      this.lastRefillTime = now;
    }
  }

  private ensureScheduled(): void {
    if (this.timer !== null) return;
    if (this.getTotalQueueDepth() === 0) return;

    const now = Date.now();
    const timeSinceLast = now - this.lastRefillTime;
    const waitTime = Math.max(0, this.intervalMs - timeSinceLast);

    this.timer = setTimeout(() => {
      this.timer = null;
      this.processNext();
    }, waitTime);
  }

  private processNext(): void {
    this.refill();

    if (this.tokens < 1) {
      this.ensureScheduled();
      return;
    }

    const nextItem = this.pickNext();
    if (!nextItem) return;

    this.tokens -= 1;
    this.lastRefillTime = Date.now();
    nextItem.resolve();

    if (this.getTotalQueueDepth() > 0) {
      this.ensureScheduled();
    }
  }

  private pickNext(): QueuedRequest | null {
    const now = Date.now();

    // Aging guard: check if any low or normal item has waited longer than agingMs
    for (const lane of ['low', 'normal'] as const) {
      const oldest = this.queues[lane][0];
      if (oldest && now - oldest.enqueuedAt >= this.agingMs) {
        this.queues[lane].shift();
        this.notifyQueueChange(lane);
        return oldest;
      }
    }

    // Strict priority: high > normal > low
    for (const lane of ['high', 'normal', 'low'] as const) {
      const item = this.queues[lane].shift();
      if (item) {
        this.notifyQueueChange(lane);
        return item;
      }
    }

    return null;
  }

  public destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const lane of ['high', 'normal', 'low'] as const) {
      while (this.queues[lane].length > 0) {
        const item = this.queues[lane].shift()!;
        item.reject(new Error('Limiter destroyed'));
      }
      this.notifyQueueChange(lane);
    }
  }
}
