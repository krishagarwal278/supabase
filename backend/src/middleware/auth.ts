/**
 * Authentication Middleware
 *
 * Provides JWT-based authentication using Supabase Auth.
 */

import { SupabaseClient, User } from '@supabase/supabase-js';
import { Request, Response, NextFunction } from 'express';
import { getServiceClient, createUserClient } from '@/lib/database';
import { AuthenticationError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Extend Express Request with auth context
 */
export interface AuthenticatedRequest extends Request {
  user: User;
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Type guard to check if request is authenticated
 */
export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return 'user' in req && 'supabase' in req && req.user !== undefined;
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7).trim();
}

/**
 * Authentication middleware - requires valid JWT token
 *
 * Verifies the JWT token with Supabase and attaches user info to request.
 * Use this for routes that require authentication.
 *
 * @example
 * router.get('/protected', authenticate, (req, res) => {
 *   const user = (req as AuthenticatedRequest).user;
 *   // ...
 * });
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const reqLogger = logger.child({ requestId: res.locals['requestId'] as string | undefined });

  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw new AuthenticationError('Missing or invalid authorization header');
    }

    // Create user-scoped client and verify token
    const userClient = createUserClient(token);
    const {
      data: { user },
      error,
    } = await userClient.auth.getUser(token);

    if (error || !user) {
      reqLogger.warn('Authentication failed', {
        error: error?.message,
        hasUser: !!user,
      });
      throw new AuthenticationError('Invalid or expired token');
    }

    // Attach user context to request
    (req as AuthenticatedRequest).user = user;
    (req as AuthenticatedRequest).supabase = userClient;
    (req as AuthenticatedRequest).userId = user.id;

    reqLogger.debug('User authenticated', { userId: user.id });

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication middleware
 *
 * Attempts to authenticate but allows request to proceed even if no token.
 * Useful for routes that have different behavior for authenticated vs anonymous users.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    // No token provided, continue without auth
    next();
    return;
  }

  try {
    const userClient = createUserClient(token);
    const {
      data: { user },
      error,
    } = await userClient.auth.getUser(token);

    if (!error && user) {
      (req as AuthenticatedRequest).user = user;
      (req as AuthenticatedRequest).supabase = userClient;
      (req as AuthenticatedRequest).userId = user.id;
    }
  } catch {
    // Ignore auth errors for optional auth
  }

  next();
}

/**
 * Service-level authentication for internal/admin operations
 *
 * Uses the service role client for operations that bypass RLS.
 * Should only be used for trusted internal operations.
 */
export function useServiceClient(req: Request, _res: Response, next: NextFunction): void {
  (req as AuthenticatedRequest).supabase = getServiceClient();
  next();
}
