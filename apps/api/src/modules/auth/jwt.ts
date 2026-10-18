import jwt from 'jsonwebtoken';
import type { Role } from '../../generated/prisma/client';

export interface AuthTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

export function signAuthToken(
  payload: AuthTokenPayload,
  secret: string,
  expiresInSec: number,
): string {
  return jwt.sign(payload, secret, {
    expiresIn: expiresInSec,
    algorithm: 'HS256',
  });
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return decoded as AuthTokenPayload;
  } catch {
    return null;
  }
}
