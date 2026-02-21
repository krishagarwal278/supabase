/**
 * User Roles Service
 *
 * Manages user roles, beta tester validation, and admin checks.
 */

import {
  TABLES,
  USER_ROLES,
  ADMIN_USERS,
  MVP_CONFIG,
  INITIAL_CREDITS_BY_ROLE,
} from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { UserRoleRow, UserRoleInfo, UserRoleType } from '@/types/models';

const rolesLogger = logger.child({ service: 'roles' });

// =============================================================================
// Role Retrieval
// =============================================================================

/**
 * Get user role from database, with fallback to env-based admin check
 */
export async function getUserRole(userId: string, userEmail?: string): Promise<UserRoleType> {
  // Check env-based admin first (highest priority)
  if (isEnvAdmin(userId, userEmail)) {
    return USER_ROLES.ADMIN;
  }

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.USER_ROLES)
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    rolesLogger.error('Failed to fetch user role', { userId, error: error.message });
    throw new DatabaseError(`Failed to fetch user role: ${error.message}`);
  }

  if (data) {
    const roleRow = data as UserRoleRow;

    // Check if beta has expired
    if (roleRow.role === USER_ROLES.BETA_TESTER && roleRow.beta_expires_at) {
      const expiresAt = new Date(roleRow.beta_expires_at);
      if (expiresAt < new Date()) {
        rolesLogger.info('Beta period expired for user', { userId });
        return USER_ROLES.USER;
      }
    }

    return roleRow.role;
  }

  // Default to regular user
  return USER_ROLES.USER;
}

/**
 * Get detailed role info for a user
 */
export async function getUserRoleInfo(userId: string, userEmail?: string): Promise<UserRoleInfo> {
  const supabase = getServiceClient();

  // Check env-based admin first
  if (isEnvAdmin(userId, userEmail)) {
    return {
      userId,
      role: USER_ROLES.ADMIN,
      grantedAt: new Date().toISOString(),
      grantedBy: null,
      betaExpiresAt: null,
      isBetaExpired: false,
    };
  }

  const { data, error } = await supabase
    .from(TABLES.USER_ROLES)
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new DatabaseError(`Failed to fetch user role info: ${error.message}`);
  }

  if (data) {
    const roleRow = data as UserRoleRow;
    const isBetaExpired =
      roleRow.role === USER_ROLES.BETA_TESTER &&
      roleRow.beta_expires_at !== null &&
      new Date(roleRow.beta_expires_at) < new Date();

    return {
      userId: roleRow.user_id,
      role: isBetaExpired ? USER_ROLES.USER : roleRow.role,
      grantedAt: roleRow.granted_at,
      grantedBy: roleRow.granted_by,
      betaExpiresAt: roleRow.beta_expires_at,
      isBetaExpired,
    };
  }

  // Default user role
  return {
    userId,
    role: USER_ROLES.USER,
    grantedAt: new Date().toISOString(),
    grantedBy: null,
    betaExpiresAt: null,
    isBetaExpired: false,
  };
}

// =============================================================================
// Role Checks
// =============================================================================

/**
 * Check if user ID or email is in env-based admin list
 */
export function isEnvAdmin(userId: string, userEmail?: string): boolean {
  if (ADMIN_USERS.userIds.includes(userId)) {
    return true;
  }
  if (userEmail && ADMIN_USERS.emails.includes(userEmail)) {
    return true;
  }
  return false;
}

/**
 * Check if user is an admin (database or env-based)
 */
export async function isAdmin(userId: string, userEmail?: string): Promise<boolean> {
  const role = await getUserRole(userId, userEmail);
  return role === USER_ROLES.ADMIN;
}

/**
 * Synchronous admin check (env-based only, for middleware)
 */
export function isAdminSync(userId: string, userEmail?: string): boolean {
  return isEnvAdmin(userId, userEmail);
}

/**
 * Check if user is a beta tester with active beta period
 */
export async function isBetaTester(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role === USER_ROLES.BETA_TESTER;
}

/**
 * Check if user is a beta tester by email in interest_submissions
 */
export async function isBetaTesterByEmail(email: string): Promise<boolean> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.INTEREST_SUBMISSIONS)
    .select('is_beta_user')
    .eq('email', email)
    .eq('is_beta_user', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    rolesLogger.warn('Failed to check beta status by email', { email, error: error.message });
    return false;
  }

  return data?.is_beta_user === true;
}

// =============================================================================
// Role Assignment
// =============================================================================

/**
 * Assign a role to a user
 */
export async function assignRole(
  userId: string,
  role: UserRoleType,
  grantedBy?: string
): Promise<UserRoleInfo> {
  const supabase = getServiceClient();

  // Calculate beta expiration if assigning beta_tester role
  let betaExpiresAt: string | null = null;
  if (role === USER_ROLES.BETA_TESTER) {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + MVP_CONFIG.BETA_PERIOD_DAYS);
    betaExpiresAt = expirationDate.toISOString();
  }

  const { data, error } = await supabase
    .from(TABLES.USER_ROLES)
    .upsert(
      {
        user_id: userId,
        role,
        granted_by: grantedBy || null,
        granted_at: new Date().toISOString(),
        beta_expires_at: betaExpiresAt,
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to assign role: ${error.message}`);
  }

  rolesLogger.info('Role assigned', { userId, role, grantedBy, betaExpiresAt });

  const roleRow = data as UserRoleRow;
  return {
    userId: roleRow.user_id,
    role: roleRow.role,
    grantedAt: roleRow.granted_at,
    grantedBy: roleRow.granted_by,
    betaExpiresAt: roleRow.beta_expires_at,
    isBetaExpired: false,
  };
}

/**
 * Grant beta tester status to a user
 */
export async function grantBetaAccess(userId: string, grantedBy?: string): Promise<UserRoleInfo> {
  return assignRole(userId, USER_ROLES.BETA_TESTER, grantedBy);
}

/**
 * Revoke beta tester status (downgrade to regular user)
 */
export async function revokeBetaAccess(userId: string): Promise<UserRoleInfo> {
  return assignRole(userId, USER_ROLES.USER);
}

/**
 * Grant admin status to a user
 */
export async function grantAdminAccess(userId: string, grantedBy: string): Promise<UserRoleInfo> {
  return assignRole(userId, USER_ROLES.ADMIN, grantedBy);
}

// =============================================================================
// Beta User Onboarding
// =============================================================================

/**
 * Process new user signup - check if they're an approved beta user
 * and set up their role and credits accordingly
 */
export async function processNewUserSignup(
  userId: string,
  email: string
): Promise<{
  role: UserRoleType;
  isBetaUser: boolean;
  initialCredits: number;
}> {
  const supabase = getServiceClient();

  // Check if email is in interest_submissions as approved beta user
  const { data: submission, error: submissionError } = await supabase
    .from(TABLES.INTEREST_SUBMISSIONS)
    .select('*')
    .eq('email', email)
    .eq('is_beta_user', true)
    .single();

  if (submissionError && submissionError.code !== 'PGRST116') {
    rolesLogger.warn('Failed to check interest submission', {
      email,
      error: submissionError.message,
    });
  }

  let role: UserRoleType = USER_ROLES.USER;
  let isBetaUser = false;

  if (submission?.is_beta_user) {
    role = USER_ROLES.BETA_TESTER;
    isBetaUser = true;

    // Assign beta role
    await assignRole(userId, USER_ROLES.BETA_TESTER);

    rolesLogger.info('New beta user signed up', { userId, email });
  }

  const initialCredits = INITIAL_CREDITS_BY_ROLE[role];

  return {
    role,
    isBetaUser,
    initialCredits,
  };
}

// =============================================================================
// Admin Functions
// =============================================================================

/**
 * Get all users with their roles (admin only)
 */
export async function getAllUsersWithRoles(
  page: number = 1,
  pageSize: number = 50
): Promise<{ users: UserRoleInfo[]; total: number }> {
  const supabase = getServiceClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from(TABLES.USER_ROLES)
    .select('*', { count: 'exact' })
    .order('granted_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new DatabaseError(`Failed to fetch users with roles: ${error.message}`);
  }

  const users = (data || []).map((row: UserRoleRow) => {
    const isBetaExpired =
      row.role === USER_ROLES.BETA_TESTER &&
      row.beta_expires_at !== null &&
      new Date(row.beta_expires_at) < new Date();

    return {
      userId: row.user_id,
      role: isBetaExpired ? USER_ROLES.USER : row.role,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
      betaExpiresAt: row.beta_expires_at,
      isBetaExpired,
    } as UserRoleInfo;
  });

  return { users, total: count || 0 };
}

/**
 * Get count of active beta users
 */
export async function getActiveBetaUserCount(): Promise<number> {
  const supabase = getServiceClient();

  const { count, error } = await supabase
    .from(TABLES.USER_ROLES)
    .select('*', { count: 'exact', head: true })
    .eq('role', USER_ROLES.BETA_TESTER)
    .or(`beta_expires_at.is.null,beta_expires_at.gt.${new Date().toISOString()}`);

  if (error) {
    rolesLogger.warn('Failed to count beta users', { error: error.message });
    return 0;
  }

  return count || 0;
}

/**
 * Check if we can accept more beta users
 */
export async function canAcceptMoreBetaUsers(): Promise<boolean> {
  const currentCount = await getActiveBetaUserCount();
  return currentCount < MVP_CONFIG.MAX_BETA_USERS;
}
