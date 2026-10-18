import { EventEmitter } from 'node:events';
import type { ZodType } from 'zod';
import {
  cfResponseSchema,
  CfProblemsetProblemsResultSchema,
  CfSubmissionSchema,
  CfUserSchema,
  type CfProblemsetProblemsResult,
  type CfSubmission,
  type CfUser,
  type PriorityLane,
} from './types';
import { PriorityTokenBucket } from './limiter';

export interface CfMetricsHooks {
  onCfRequest?: (endpoint: string, status: string, durationSec: number) => void;
  onQueueDepth?: (lane: PriorityLane, depth: number) => void;
}

export interface CfClientOptions {
  baseUrl?: string;
  userAgent: string;
  maxRps?: number;
  timeoutMs?: number;
  retryMax?: number;
  retryBaseMs?: number;
  retryMaxDelayMs?: number;
  degradedAfterFailures?: number;
  metrics?: CfMetricsHooks;
}

export type CircuitState = 'OK' | 'DEGRADED';

export class CfError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
    public readonly statusCode?: number,
    public readonly comment?: string,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = 'CfError';
  }
}

export class CfUserNotFoundError extends CfError {
  constructor(endpoint: string, comment?: string) {
    super(`User not found: ${comment ?? ''}`, endpoint, 404, comment, false);
    this.name = 'CfUserNotFoundError';
  }
}

export class CfRateLimitError extends CfError {
  constructor(endpoint: string, comment?: string) {
    super(`Codeforces rate limit exceeded: ${comment ?? ''}`, endpoint, 429, comment, true);
    this.name = 'CfRateLimitError';
  }
}

export class CfClient extends EventEmitter {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retryMax: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly degradedThreshold: number;
  private readonly limiter: PriorityTokenBucket;
  private readonly metrics?: CfMetricsHooks;

  private circuitState: CircuitState = 'OK';
  private consecutiveFailures = 0;

  constructor(options: CfClientOptions) {
    super();
    this.baseUrl = (options.baseUrl ?? 'https://codeforces.com/api').replace(/\/+$/, '');
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryMax = options.retryMax ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 8_000;
    this.degradedThreshold = options.degradedAfterFailures ?? 4;
    this.metrics = options.metrics;

    this.limiter = new PriorityTokenBucket({
      maxRps: options.maxRps ?? 2,
      onQueueDepthChange: (lane, depth) => {
        this.metrics?.onQueueDepth?.(lane, depth);
      },
    });
  }

  public getCircuitState(): CircuitState {
    return this.circuitState;
  }

  public isDegraded(): boolean {
    return this.circuitState === 'DEGRADED';
  }

  public getLimiter(): PriorityTokenBucket {
    return this.limiter;
  }

  /**
   * Fetches problemset problems and statistics.
   */
  public async problemsetProblems(options?: {
    tags?: string[];
    lane?: PriorityLane;
  }): Promise<CfProblemsetProblemsResult> {
    const params: Record<string, string> = {};
    if (options?.tags && options.tags.length > 0) {
      params['tags'] = options.tags.join(';');
    }

    const data = await this.request(
      'problemset.problems',
      params,
      options?.lane ?? 'low',
      CfProblemsetProblemsResultSchema,
    );
    return data;
  }

  /**
   * Fetches recent submissions across the problemset.
   */
  public async problemsetRecentStatus(
    count: number,
    lane: PriorityLane = 'normal',
  ): Promise<CfSubmission[]> {
    const clampedCount = Math.max(1, Math.min(1000, count));
    const data = await this.request(
      'problemset.recentStatus',
      { count: clampedCount.toString() },
      lane,
      CfSubmissionSchema.array(),
    );
    return data;
  }

  /**
   * Fetches submissions for a specific handle.
   */
  public async userStatus(
    handle: string,
    from = 1,
    count = 10,
    lane: PriorityLane = 'normal',
  ): Promise<CfSubmission[]> {
    const data = await this.request(
      'user.status',
      {
        handle,
        from: Math.max(1, from).toString(),
        count: Math.max(1, count).toString(),
      },
      lane,
      CfSubmissionSchema.array(),
    );
    return data;
  }

  /**
   * Fetches user info for one or more handles.
   */
  public async userInfo(handles: string[], lane: PriorityLane = 'high'): Promise<CfUser[]> {
    if (handles.length === 0) return [];
    const data = await this.request(
      'user.info',
      { handles: handles.join(';') },
      lane,
      CfUserSchema.array(),
    );
    return data;
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, string>,
    lane: PriorityLane,
    resultSchema: ZodType<T>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    let attempt = 0;
    while (true) {
      attempt++;
      await this.limiter.acquire(lane);

      const startTime = Date.now();
      try {
        const result = await this.executeFetch(endpoint, url.toString(), resultSchema);
        this.recordSuccess(endpoint, Date.now() - startTime);
        return result;
      } catch (err: unknown) {
        const durationSec = (Date.now() - startTime) / 1000;
        const cfError = this.normalizeError(endpoint, err);
        this.metrics?.onCfRequest?.(
          endpoint,
          cfError.statusCode ? String(cfError.statusCode) : 'error',
          durationSec,
        );

        // Check if retryable
        if (cfError.isRetryable && attempt <= this.retryMax) {
          const backoffMs = this.computeBackoff(attempt);
          await new Promise((res) => setTimeout(res, backoffMs));
          continue;
        }

        // Permanent failure or retries exhausted
        if (cfError.isRetryable) {
          this.recordFailure();
        }
        throw cfError;
      }
    }
  }

  private async executeFetch<T>(
    endpoint: string,
    urlString: string,
    resultSchema: ZodType<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();

    let response: Response;
    try {
      response = await fetch(urlString, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new CfError(
          `Request timed out after ${this.timeoutMs}ms`,
          endpoint,
          408,
          undefined,
          true,
        );
      }
      throw new CfError(
        `Network error: ${(err as Error).message}`,
        endpoint,
        undefined,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const is5xx = response.status >= 500 && response.status < 600;
    const is429 = response.status === 429;

    let text: string;
    try {
      text = await response.text();
    } catch (err: unknown) {
      throw new CfError(
        `Failed to read response: ${(err as Error).message}`,
        endpoint,
        response.status,
        undefined,
        true,
      );
    }

    if (is5xx) {
      throw new CfError(
        `HTTP ${response.status} server error: ${text.slice(0, 100)}`,
        endpoint,
        response.status,
        text,
        true,
      );
    }
    if (is429) {
      throw new CfRateLimitError(endpoint, text);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err: unknown) {
      throw new CfError(
        `Invalid JSON from Codeforces: ${(err as Error).message}`,
        endpoint,
        response.status,
        text,
        true,
      );
    }

    const EnvelopeSchema = cfResponseSchema(resultSchema);
    const parsedEnvelope = EnvelopeSchema.safeParse(json);

    if (!parsedEnvelope.success) {
      throw new CfError(
        `Failed to parse Codeforces envelope: ${parsedEnvelope.error.message}`,
        endpoint,
        response.status,
        text,
        false,
      );
    }

    const envelope = parsedEnvelope.data;
    if (envelope.status === 'FAILED') {
      const comment = envelope.comment ?? '';
      if (/limit/i.test(comment)) {
        throw new CfRateLimitError(endpoint, comment);
      }
      if (/not found/i.test(comment) || /handle.*not found/i.test(comment)) {
        throw new CfUserNotFoundError(endpoint, comment);
      }
      throw new CfError(
        `Codeforces API error: ${comment}`,
        endpoint,
        response.status,
        comment,
        false,
      );
    }

    if (envelope.result === undefined) {
      throw new CfError(
        'Missing result in OK response',
        endpoint,
        response.status,
        undefined,
        false,
      );
    }

    return envelope.result as T;
  }

  private computeBackoff(attempt: number): number {
    // Exponential backoff with full jitter: rand(0, min(maxDelay, base * 2^(attempt-1)))
    const maxBackoff = Math.min(this.retryMaxDelayMs, this.retryBaseMs * Math.pow(2, attempt - 1));
    return Math.floor(Math.random() * maxBackoff);
  }

  private normalizeError(endpoint: string, err: unknown): CfError {
    if (err instanceof CfError) return err;
    return new CfError(
      (err as Error).message ?? 'Unknown error',
      endpoint,
      undefined,
      undefined,
      true,
    );
  }

  private recordSuccess(endpoint: string, durationMs: number): void {
    this.metrics?.onCfRequest?.(endpoint, 'OK', durationMs / 1000);
    if (this.consecutiveFailures > 0 || this.circuitState === 'DEGRADED') {
      this.consecutiveFailures = 0;
      if (this.circuitState === 'DEGRADED') {
        this.circuitState = 'OK';
        this.emit('stateChange', 'OK');
        this.emit('recovered');
      }
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.degradedThreshold && this.circuitState !== 'DEGRADED') {
      this.circuitState = 'DEGRADED';
      this.emit('stateChange', 'DEGRADED');
      this.emit('degraded');
    }
  }

  public destroy(): void {
    this.limiter.destroy();
    this.removeAllListeners();
  }
}
