import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger';
import { AppError, errorBody } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in addition to SameSite=Lax (§7): reject mutating requests whose Origin header
 * is present but not in the allowlist. Browsers always send Origin on cross-site POSTs; non-browser
 * clients (bots, tests) that omit it can't carry a victim's cookie anyway.
 */
export function originCheck(allowed: readonly string[]): RequestHandler {
  const set = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !set.has(origin)) {
      return next(new AppError('FORBIDDEN', 'Origin not allowed'));
    }
    next();
  };
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', 'Route not found'));
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError) {
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid request', err.issues));
      return;
    }
    // body-parser errors carry a status
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json(errorBody('BAD_REQUEST', (err as Error).message));
      return;
    }
    logger.error({ err, path: req.path }, 'unhandled error');
    res.status(500).json(errorBody('INTERNAL', 'Internal server error'));
  };
}

/** Parse `req[part]` with a Zod schema; throws ZodError → 400 via errorHandler. */
export function parse<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}
