/**
 * Typed application errors (Part B §4).
 *
 * Services throw these; the single Fastify error handler maps them to the fixed error
 * body. Services never import Fastify, so they never build HTTP responses themselves.
 */

/** The closed set of error codes the Android client switches on. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  LAST_OWNER: 'LAST_OWNER',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Field-level detail, keyed by field path: { "title": "LENGTH_INVALID" }. */
export type ErrorFields = Record<string, string>;

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ErrorCodeValue;
  readonly fields?: ErrorFields;

  constructor(message: string, fields?: ErrorFields) {
    super(message);
    this.name = new.target.name;
    if (fields) this.fields = fields;
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = ErrorCode.VALIDATION_FAILED;

  constructor(message = 'Validation failed', fields?: ErrorFields) {
    super(message, fields);
  }
}

export class InvalidCredentialsError extends AppError {
  readonly statusCode = 401;
  readonly code = ErrorCode.INVALID_CREDENTIALS;

  constructor(message = 'Email or password is incorrect') {
    super(message);
  }
}

export class EmailAlreadyExistsError extends AppError {
  readonly statusCode = 409;
  readonly code = ErrorCode.EMAIL_ALREADY_EXISTS;

  constructor(message = 'An account with this email already exists') {
    super(message);
  }
}

export class TokenExpiredError extends AppError {
  readonly statusCode = 401;
  readonly code = ErrorCode.TOKEN_EXPIRED;

  constructor(message = 'Access token has expired') {
    super(message);
  }
}

export class TokenInvalidError extends AppError {
  readonly statusCode = 401;
  readonly code = ErrorCode.TOKEN_INVALID;

  constructor(message = 'Access token is missing or invalid') {
    super(message);
  }
}

export class RefreshTokenInvalidError extends AppError {
  readonly statusCode = 401;
  readonly code = ErrorCode.REFRESH_TOKEN_INVALID;

  constructor(message = 'Refresh token is invalid or has been revoked') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = ErrorCode.FORBIDDEN;

  constructor(message = 'You are not allowed to perform this action') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = ErrorCode.NOT_FOUND;

  constructor(message = 'Resource not found') {
    super(message);
  }
}

/**
 * 409 with a top-level `current` field holding the server's copy (Part B §7.2), so the
 * client can re-apply its edit on top of the newer version.
 */
export class VersionConflictError<T = unknown> extends AppError {
  readonly statusCode = 409;
  readonly code = ErrorCode.VERSION_CONFLICT;
  readonly current: T;

  constructor(current: T, message = 'Resource was changed by someone else') {
    super(message);
    this.current = current;
  }
}

export class AlreadyMemberError extends AppError {
  readonly statusCode = 409;
  readonly code = ErrorCode.ALREADY_MEMBER;

  constructor(message = 'User is already a member of this workspace') {
    super(message);
  }
}

export class LastOwnerError extends AppError {
  readonly statusCode = 409;
  readonly code = ErrorCode.LAST_OWNER;

  constructor(message = 'A workspace must always have at least one OWNER') {
    super(message);
  }
}

export class FileTooLargeError extends AppError {
  readonly statusCode = 413;
  readonly code = ErrorCode.FILE_TOO_LARGE;

  constructor(message = 'File exceeds the maximum allowed size') {
    super(message);
  }
}

export class UnsupportedFileTypeError extends AppError {
  readonly statusCode = 400;
  readonly code = ErrorCode.UNSUPPORTED_FILE_TYPE;

  constructor(message = 'File type is not supported') {
    super(message);
  }
}

export class RateLimitedError extends AppError {
  readonly statusCode = 429;
  readonly code = ErrorCode.RATE_LIMITED;

  constructor(message = 'Too many requests') {
    super(message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
