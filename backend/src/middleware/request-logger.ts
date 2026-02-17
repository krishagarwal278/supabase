/**
 * Request Logger Middleware
 *
 * Logs incoming requests and outgoing responses with timing information.
 * Assigns unique request IDs for distributed tracing.
 */

import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '@/lib/logger';

/**
 * Request ID header name (follows OpenTelemetry conventions)
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Request logging middleware
 *
 * - Assigns a unique request ID (or uses provided one)
 * - Logs request details on entry
 * - Logs response details on completion (including duration)
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Use existing request ID or generate new one
  const requestId = (req.headers[REQUEST_ID_HEADER] as string) || randomUUID();

  // Store request ID for use in handlers and responses
  res.locals['requestId'] = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  // Create request-scoped logger
  const reqLogger = logger.child({ requestId });

  // Log incoming request
  reqLogger.info('Request received', {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket.remoteAddress,
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    reqLogger[level]('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

/**
 * Skip logging for certain paths (health checks, static assets)
 */
const SKIP_PATHS = ['/health', '/favicon.ico', '/_health'];

/**
 * Request logging middleware with path filtering
 *
 * Same as requestLogger but skips logging for certain paths
 * to reduce noise in logs.
 */
export function requestLoggerWithFilter(req: Request, res: Response, next: NextFunction): void {
  // Skip logging for filtered paths
  if (SKIP_PATHS.some((path) => req.path.startsWith(path))) {
    // Still assign request ID even for skipped paths
    const requestId = (req.headers[REQUEST_ID_HEADER] as string) || randomUUID();
    res.locals['requestId'] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
    return;
  }

  requestLogger(req, res, next);
}
