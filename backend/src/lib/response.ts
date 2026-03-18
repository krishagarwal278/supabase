/**
 * API Response Helpers
 *
 * Consistent response format for all API endpoints.
 * Follows OpenShift Console patterns for API responses.
 */

import { Response } from 'express';
import { HTTP_STATUS, PAGINATION } from '@/config/constants';

/**
 * Standard API response format
 */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
  };
  meta?: ResponseMeta;
}

/**
 * Response metadata (pagination, timestamps, etc.)
 */
interface ResponseMeta {
  timestamp: string;
  requestId?: string;
  pagination?: PaginationMeta;
}

/**
 * Pagination metadata
 */
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Pagination input parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

/**
 * Create a success response
 */
export function success<T>(
  res: Response,
  data: T,
  statusCode: number = HTTP_STATUS.OK,
  meta?: Partial<ResponseMeta>
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: res.locals['requestId'] as string | undefined,
      ...meta,
    },
  };

  return res.status(statusCode).json(response);
}

/**
 * Create a success response with pagination
 */
export function paginated<T>(
  res: Response,
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
  statusCode: number = HTTP_STATUS.OK
): Response {
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const response: ApiResponse<T[]> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: res.locals['requestId'] as string | undefined,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
      },
    },
  };

  return res.status(statusCode).json(response);
}

/**
 * Create a created response (201)
 */
export function created<T>(res: Response, data: T): Response {
  return success(res, data, HTTP_STATUS.CREATED);
}

/**
 * Create a no content response (204)
 */
export function noContent(res: Response): Response {
  return res.status(HTTP_STATUS.NO_CONTENT).send();
}

/**
 * Create an error response.
 * When fieldErrors is provided (e.g. validation), frontend reads error.fieldErrors.
 * When options is a plain object (e.g. { required, available }), it is used as error.details for backward compat.
 */
export function error(
  res: Response,
  code: string,
  message: string,
  statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  options?: { details?: Record<string, unknown>; fieldErrors?: Record<string, string[]> } & Record<
    string,
    unknown
  >
): Response {
  const errorObj: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
  } = { code, message };
  if (options?.fieldErrors) {
    errorObj.fieldErrors = options.fieldErrors;
  }
  if (options?.details) {
    errorObj.details = options.details;
  } else if (options && Object.keys(options).filter((k) => k !== 'fieldErrors').length > 0) {
    const { fieldErrors: _f, ...rest } = options;
    errorObj.details = rest as Record<string, unknown>;
  }

  const response: ApiResponse = {
    success: false,
    error: errorObj,
    meta: {
      timestamp: new Date().toISOString(),
      requestId: res.locals['requestId'] as string | undefined,
    },
  };

  return res.status(statusCode).json(response);
}

/**
 * Parse pagination parameters from query
 */
export function parsePaginationParams(query: { page?: string; limit?: string }): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(query.page || String(PAGINATION.DEFAULT_PAGE), 10));
  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, parseInt(query.limit || String(PAGINATION.DEFAULT_LIMIT), 10))
  );
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Create pagination metadata from results
 */
export function createPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// Export types
export type { ApiResponse, ResponseMeta, PaginationMeta };
