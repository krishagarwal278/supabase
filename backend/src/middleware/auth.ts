/**
 * Authentication Middleware
 *
 * Provides JWT-based authentication using Supabase Auth.
 */

import { SupabaseClient, User } from '@supabase/supabase-js';
import { Request, Response, NextFunction } from 'express';
import { getServiceClient, createUserClient } from '@/lib/database';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import * as rolesService from '@/services/roles.service';
import type { UserRoleType } from '@/types/models';

/**
 * Extend Express Request with auth context
 */
export interface AuthenticatedRequest extends Request {
  user: User;
  supabase: SupabaseClient;
  userId: string;
  userRole?: UserRoleType;
  isAdmin?: boolean;
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

/**
 * Admin authorization middleware
 *
 * Requires the user to be authenticated AND have admin role.
 * Must be used after authenticate middleware.
 *
 * @example
 * router.get('/admin-only', authenticate, requireAdmin, (req, res) => {
 *   // Only admins can reach here
 * });
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const reqLogger = logger.child({ requestId: res.locals['requestId'] as string | undefined });

  try {
    if (!isAuthenticated(req)) {
      throw new AuthenticationError('Authentication required');
    }

    const authReq = req as AuthenticatedRequest;
    const isAdmin = await rolesService.isAdmin(authReq.userId, authReq.user.email);

    if (!isAdmin) {
      reqLogger.warn('Admin access denied', { userId: authReq.userId });
      throw new AuthorizationError('Admin access required');
    }

    authReq.isAdmin = true;
    authReq.userRole = 'admin';

    reqLogger.debug('Admin access granted', { userId: authReq.userId });
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Beta tester authorization middleware
 *
 * Requires the user to be authenticated AND have beta_tester or admin role.
 * Must be used after authenticate middleware.
 */
export async function requireBetaOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const reqLogger = logger.child({ requestId: res.locals['requestId'] as string | undefined });

  try {
    if (!isAuthenticated(req)) {
      throw new AuthenticationError('Authentication required');
    }

    const authReq = req as AuthenticatedRequest;
    const role = await rolesService.getUserRole(authReq.userId, authReq.user.email);

    if (role !== 'admin' && role !== 'beta_tester') {
      reqLogger.warn('Beta/Admin access denied', { userId: authReq.userId, role });
      throw new AuthorizationError('Beta tester or admin access required');
    }

    authReq.userRole = role;
    authReq.isAdmin = role === 'admin';

    reqLogger.debug('Beta/Admin access granted', { userId: authReq.userId, role });
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attach user role to request (non-blocking)
 *
 * Fetches and attaches user role to request for use in handlers.
 * Does not block the request if role fetch fails.
 */
export async function attachUserRole(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isAuthenticated(req)) {
    next();
    return;
  }

  try {
    const authReq = req as AuthenticatedRequest;
    const role = await rolesService.getUserRole(authReq.userId, authReq.user.email);
    authReq.userRole = role;
    authReq.isAdmin = role === 'admin';
  } catch {
    // Non-blocking - continue without role
  }

  next();
}
