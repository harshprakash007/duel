import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import { AppError } from './errors';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  redis?: Redis;
  prefix?: string;
  keyGenerator?: (req: { ip?: string; user?: { sub: string } }) => string;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimitRequestHandler {
  const store = options.redis
    ? new RedisStore({
        // @ts-expect-error ioredis sendCommand compatibility
        sendCommand: (...args: string[]) => options.redis.call(...args),
        prefix: options.prefix ?? 'rl:',
      })
    : undefined;

  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    keyGenerator: (req) => {
      if (options.keyGenerator) {
        return options.keyGenerator(req as Parameters<typeof options.keyGenerator>[0]);
      }
      // If user is authenticated, limit per user ID, otherwise per IP
      const user = (req as { user?: { sub: string } }).user;
      return user?.sub ?? req.ip ?? 'unknown';
    },
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests, please try again later'));
    },
  });
}
