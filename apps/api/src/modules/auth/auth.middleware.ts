import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../lib/errors';
import { verifyAuthToken, type AuthTokenPayload } from './jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function authMiddleware(secret: string, cookieName: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    let token = req.cookies?.[cookieName];

    // Fallback to Authorization: Bearer <token>
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }

    if (token) {
      const payload = verifyAuthToken(token, secret);
      if (payload) {
        req.user = payload;
      }
    }

    next();
  };
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError('UNAUTHENTICATED', 'Authentication required'));
    return;
  }
  if (req.user.role !== 'ADMIN') {
    next(new AppError('FORBIDDEN', 'Admin access required'));
    return;
  }
  next();
}

/** Extracts user payload from a raw Cookie header (e.g. Socket.IO handshake). */
export function extractUserFromCookieHeader(
  cookieHeader: string | undefined,
  secret: string,
  cookieName: string,
): AuthTokenPayload | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!match || !match[1]) return null;
  return verifyAuthToken(decodeURIComponent(match[1]), secret);
}
