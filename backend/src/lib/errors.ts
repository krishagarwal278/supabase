/**
 * Custom Error Classes
 *
 * Application-specific error classes for consistent error handling.
 * Inspired by OpenShift's structured error handling approach.
 */

import { HTTP_STATUS } from '@/config/constants';

/**
 * Base application error class
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean = true;
  readonly timestamp: string;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON-serializable object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * 400 Bad Request - Invalid input from client
 */
export class ValidationError extends AppError {
  readonly statusCode = HTTP_STATUS.BAD_REQUEST;
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
export class AuthenticationError extends AppError {
  readonly statusCode = HTTP_STATUS.UNAUTHORIZED;
  readonly code = 'AUTHENTICATION_ERROR';

  constructor(message = 'Authentication required') {
    super(message);
  }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class AuthorizationError extends AppError {
  readonly statusCode = HTTP_STATUS.FORBIDDEN;
  readonly code = 'AUTHORIZATION_ERROR';

  constructor(message = 'Insufficient permissions') {
    super(message);
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends AppError {
  readonly statusCode = HTTP_STATUS.NOT_FOUND;
  readonly code = 'NOT_FOUND';

  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, { resource, identifier });
  }
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
export class ConflictError extends AppError {
  readonly statusCode = HTTP_STATUS.CONFLICT;
  readonly code = 'CONFLICT';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends AppError {
  readonly statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(
    message = 'Too many requests, please try again later',
    public readonly retryAfter?: number
  ) {
    super(message, { retryAfter });
  }
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
export class InternalError extends AppError {
  readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  readonly code = 'INTERNAL_ERROR';
  override readonly isOperational = false;

  constructor(message = 'An unexpected error occurred') {
    super(message);
  }
}

/**
 * 503 Service Unavailable - External service failure
 */
export class ServiceUnavailableError extends AppError {
  readonly statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(service: string, message?: string) {
    super(message || `${service} is currently unavailable`, { service });
  }
}

/**
 * Database-specific errors
 */
export class DatabaseError extends AppError {
  readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  readonly code = 'DATABASE_ERROR';

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * External API errors (OpenAI, Runway, etc.)
 */
export class ExternalServiceError extends AppError {
  readonly statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
  readonly code = 'EXTERNAL_SERVICE_ERROR';

  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service}: ${message}`, { service, ...details });
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if error is operational (expected)
 */
export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap unknown errors into AppError
 */
export function wrapError(error: unknown, defaultMessage = 'An error occurred'): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalError(error.message);
  }

  if (typeof error === 'string') {
    return new InternalError(error);
  }

  return new InternalError(defaultMessage);
}
