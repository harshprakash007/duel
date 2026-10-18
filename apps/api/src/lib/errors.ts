export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CF_UNAVAILABLE'
  | 'CF_NOT_FOUND'
  | 'HANDLE_TAKEN'
  | 'HANDLE_ALREADY_LINKED'
  | 'HANDLE_REQUIRED'
  | 'VERIFICATION_NOT_FOUND'
  | 'VERIFICATION_EXPIRED'
  | 'VERIFICATION_FAILED'
  | 'ALREADY_ACTIVE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'MATCH_NOT_FOUND'
  | 'NOT_PARTICIPANT'
  | 'INVALID_STATE'
  | 'COOLDOWN'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CF_UNAVAILABLE: 503,
  CF_NOT_FOUND: 404,
  HANDLE_TAKEN: 409,
  HANDLE_ALREADY_LINKED: 409,
  HANDLE_REQUIRED: 403,
  VERIFICATION_NOT_FOUND: 404,
  VERIFICATION_EXPIRED: 410,
  VERIFICATION_FAILED: 422,
  ALREADY_ACTIVE: 409,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  MATCH_NOT_FOUND: 404,
  NOT_PARTICIPANT: 403,
  INVALID_STATE: 409,
  COOLDOWN: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
