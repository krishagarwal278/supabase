/**
 * Global Error Handler Middleware
 *
 * Catches all errors and formats them consistently.
 * Inspired by OpenShift Console's error handling patterns.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { isProduction } from '@/config/env';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { error as errorResponse } from '@/lib/response';

/**
 * Format Zod validation errors into a readable format
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }

  return errors;
}

/**
 * Global error handler middleware
 *
 * Must be registered after all routes.
 * Handles all error types and returns consistent JSON responses.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const reqLogger = logger.child({
    requestId: res.locals['requestId'] as string | undefined,
    path: req.path,
    method: req.method,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const fieldErrors = formatZodErrors(err);
    reqLogger.warn('Validation error', { errors: fieldErrors });

    errorResponse(res, 'VALIDATION_ERROR', 'Request validation failed', HTTP_STATUS.BAD_REQUEST, {
      fieldErrors,
    });
    return;
  }

  // Handle our custom AppError types
  if (isAppError(err)) {
    // Log operational errors at warn level, programming errors at error level
    if (err.isOperational) {
      reqLogger.warn('Request failed', {
        code: err.code,
        message: err.message,
        details: err.details,
      });
    } else {
      reqLogger.error('Internal error', {
        error: err,
        code: err.code,
      });
    }

    // ValidationError: frontend reads error.fieldErrors; pass at top level of error object
    const fieldErrors =
      err.code === 'VALIDATION_ERROR' && err.details?.fieldErrors != null
        ? (err.details.fieldErrors as Record<string, string[]>)
        : undefined;
    const includeDetails =
      err.details && (err.code !== 'VALIDATION_ERROR' || !fieldErrors) && !isProduction();
    errorResponse(res, err.code, err.message, err.statusCode, {
      ...(fieldErrors && { fieldErrors }),
      ...(includeDetails && err.details && { details: err.details }),
    });
    return;
  }

  // Handle unknown errors
  reqLogger.error('Unhandled error', {
    error: err,
    stack: err.stack,
  });

  // In production, don't leak error details
  const message = isProduction() ? 'An unexpected error occurred' : err.message;

  const details = isProduction() ? undefined : { stack: err.stack };

  errorResponse(res, 'INTERNAL_ERROR', message, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
    ...(details && { details }),
  });
}

/**
 * Handle 404 Not Found for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  logger.debug('Route not found', {
    path: req.path,
    method: req.method,
    requestId: res.locals['requestId'] as string | undefined,
  });

  errorResponse(
    res,
    'NOT_FOUND',
    `Route ${req.method} ${req.path} not found`,
    HTTP_STATUS.NOT_FOUND
  );
}

/**
 * Async handler wrapper to catch errors in async route handlers
 *
 * Wraps async route handlers to properly catch and forward errors to Express.
 *
 * @example
 * router.get('/users', asyncHandler(async (req, res) => {
 *   const users = await userService.getAll();
 *   res.json(users);
 * }));
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void | Response>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
