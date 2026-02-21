/**
 * Rate Limiting Service
 *
 * Manages rate limits for video and screenplay generation.
 * Enforces limits based on user role.
 */

import * as rolesService from './roles.service';
import { TABLES, RATE_LIMITS, RATE_LIMIT_ACTIONS, USER_ROLES } from '@/config/constants';
import type { RateLimitAction } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, RateLimitError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RateLimitCheckResult, RateLimitInfo } from '@/types/models';

const rateLimitLogger = logger.child({ service: 'ratelimit' });

// =============================================================================
// Rate Limit Checking
// =============================================================================

/**
 * Check if user is within rate limits for a specific action
 */
export async function checkRateLimit(
  userId: string,
  actionType: RateLimitAction
): Promise<RateLimitCheckResult> {
  const role = await rolesService.getUserRole(userId);
  const limits = RATE_LIMITS[role];

  // Admins bypass rate limits
  if (role === USER_ROLES.ADMIN) {
    return {
      allowed: true,
      limit: 999999,
      remaining: 999999,
      resetAt: new Date(Date.now() + 86400000).toISOString(),
      periodType: 'daily',
    };
  }

  const supabase = getServiceClient();

  // Check different time windows based on action type
  if (
    actionType === RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION ||
    actionType === RATE_LIMIT_ACTIONS.SCREENPLAY_ENHANCEMENT
  ) {
    // Hourly limit for screenplays
    const hourAgo = new Date(Date.now() - 3600000).toISOString();

    const { count, error } = await supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .gte('created_at', hourAgo);

    if (error) {
      rateLimitLogger.error('Failed to check hourly rate limit', { userId, error: error.message });
      throw new DatabaseError(`Failed to check rate limit: ${error.message}`);
    }

    const used = count || 0;
    const limit = limits.screenplays_per_hour;
    const remaining = Math.max(0, limit - used);
    const resetAt = new Date(Date.now() + 3600000).toISOString();

    return {
      allowed: remaining > 0,
      limit,
      remaining,
      resetAt,
      periodType: 'hourly',
    };
  }

  // Video generation - check both daily and period limits
  if (actionType === RATE_LIMIT_ACTIONS.VIDEO_GENERATION) {
    // Daily limit
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const { count: dailyCount, error: dailyError } = await supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .gte('created_at', dayAgo);

    if (dailyError) {
      throw new DatabaseError(`Failed to check daily rate limit: ${dailyError.message}`);
    }

    const dailyUsed = dailyCount || 0;
    const dailyLimit = limits.videos_per_day;

    if (dailyUsed >= dailyLimit) {
      const resetAt = new Date(Date.now() + 86400000).toISOString();
      return {
        allowed: false,
        limit: dailyLimit,
        remaining: 0,
        resetAt,
        periodType: 'daily',
      };
    }

    // Period limit (for beta users: 14 days, for regular users: 30 days)
    const periodMs = limits.period_days * 24 * 60 * 60 * 1000;
    const periodAgo = new Date(Date.now() - periodMs).toISOString();

    const { count: periodCount, error: periodError } = await supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .gte('created_at', periodAgo);

    if (periodError) {
      throw new DatabaseError(`Failed to check period rate limit: ${periodError.message}`);
    }

    const periodUsed = periodCount || 0;
    const periodLimit = limits.videos_per_period;

    if (periodUsed >= periodLimit) {
      const resetAt = new Date(Date.now() + periodMs).toISOString();
      return {
        allowed: false,
        limit: periodLimit,
        remaining: 0,
        resetAt,
        periodType: 'period',
      };
    }

    // Return the more restrictive limit info
    const dailyRemaining = dailyLimit - dailyUsed;
    const periodRemaining = periodLimit - periodUsed;

    if (dailyRemaining <= periodRemaining) {
      return {
        allowed: true,
        limit: dailyLimit,
        remaining: dailyRemaining,
        resetAt: new Date(Date.now() + 86400000).toISOString(),
        periodType: 'daily',
      };
    }

    return {
      allowed: true,
      limit: periodLimit,
      remaining: periodRemaining,
      resetAt: new Date(Date.now() + periodMs).toISOString(),
      periodType: 'period',
    };
  }

  // Default: allow
  return {
    allowed: true,
    limit: 999,
    remaining: 999,
    resetAt: new Date(Date.now() + 86400000).toISOString(),
    periodType: 'daily',
  };
}

/**
 * Check rate limit and throw error if exceeded
 */
export async function enforceRateLimit(
  userId: string,
  actionType: RateLimitAction
): Promise<RateLimitCheckResult> {
  const result = await checkRateLimit(userId, actionType);

  if (!result.allowed) {
    const resetDate = new Date(result.resetAt);
    const retryAfter = Math.ceil((resetDate.getTime() - Date.now()) / 1000);

    let message: string;
    switch (result.periodType) {
      case 'hourly':
        message = `Hourly limit reached. Try again in ${Math.ceil(retryAfter / 60)} minutes.`;
        break;
      case 'daily':
        message = `Daily video limit reached. Try again tomorrow.`;
        break;
      case 'period':
        message = `Period video limit reached. Your limit resets on ${resetDate.toLocaleDateString()}.`;
        break;
      default:
        message = `Rate limit exceeded. Try again later.`;
    }

    throw new RateLimitError(message, retryAfter);
  }

  return result;
}

// =============================================================================
// Rate Limit Tracking
// =============================================================================

/**
 * Log an action for rate limiting
 */
export async function logAction(userId: string, actionType: RateLimitAction): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.RATE_LIMIT_TRACKING).insert({
    user_id: userId,
    action_type: actionType,
  });

  if (error) {
    rateLimitLogger.warn('Failed to log rate limit action', {
      userId,
      actionType,
      error: error.message,
    });
  }

  rateLimitLogger.debug('Rate limit action logged', { userId, actionType });
}

/**
 * Remove a logged action (for rollback on failure)
 */
export async function removeAction(userId: string, actionType: RateLimitAction): Promise<void> {
  const supabase = getServiceClient();

  // Remove the most recent action of this type
  const { data: recentAction, error: fetchError } = await supabase
    .from(TABLES.RATE_LIMIT_TRACKING)
    .select('id')
    .eq('user_id', userId)
    .eq('action_type', actionType)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !recentAction) {
    rateLimitLogger.warn('No action to remove', { userId, actionType });
    return;
  }

  const { error: deleteError } = await supabase
    .from(TABLES.RATE_LIMIT_TRACKING)
    .delete()
    .eq('id', recentAction.id);

  if (deleteError) {
    rateLimitLogger.warn('Failed to remove rate limit action', {
      userId,
      actionType,
      error: deleteError.message,
    });
  }
}

// =============================================================================
// Rate Limit Info for Headers
// =============================================================================

/**
 * Get rate limit info for API response headers
 */
export async function getRateLimitHeaders(
  userId: string,
  actionType: RateLimitAction
): Promise<RateLimitInfo> {
  const result = await checkRateLimit(userId, actionType);

  return {
    limit: result.limit,
    remaining: result.remaining,
    reset: Math.floor(new Date(result.resetAt).getTime() / 1000),
  };
}

/**
 * Set rate limit headers on response
 */
export function setRateLimitHeaders(
  res: { setHeader: (name: string, value: string | number) => void },
  info: RateLimitInfo
): void {
  res.setHeader('X-RateLimit-Limit', info.limit);
  res.setHeader('X-RateLimit-Remaining', info.remaining);
  res.setHeader('X-RateLimit-Reset', info.reset);
}

// =============================================================================
// Usage Statistics
// =============================================================================

/**
 * Get usage statistics for a user
 */
export async function getUserUsageStats(userId: string): Promise<{
  videosToday: number;
  videosPeriod: number;
  screenplaysHour: number;
  limits: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];
}> {
  const role = await rolesService.getUserRole(userId);
  const limits = RATE_LIMITS[role];
  const supabase = getServiceClient();

  // Get counts for different periods
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const periodMs = limits.period_days * 24 * 60 * 60 * 1000;
  const periodAgo = new Date(Date.now() - periodMs).toISOString();

  const [screenplaysResult, dailyVideosResult, periodVideosResult] = await Promise.all([
    supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION)
      .gte('created_at', hourAgo),
    supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', RATE_LIMIT_ACTIONS.VIDEO_GENERATION)
      .gte('created_at', dayAgo),
    supabase
      .from(TABLES.RATE_LIMIT_TRACKING)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', RATE_LIMIT_ACTIONS.VIDEO_GENERATION)
      .gte('created_at', periodAgo),
  ]);

  return {
    videosToday: dailyVideosResult.count || 0,
    videosPeriod: periodVideosResult.count || 0,
    screenplaysHour: screenplaysResult.count || 0,
    limits,
  };
}

/**
 * Clean up old rate limit tracking entries (older than 30 days)
 */
export async function cleanupOldEntries(): Promise<number> {
  const supabase = getServiceClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from(TABLES.RATE_LIMIT_TRACKING)
    .delete()
    .lt('created_at', thirtyDaysAgo)
    .select('id');

  if (error) {
    rateLimitLogger.warn('Failed to cleanup old rate limit entries', { error: error.message });
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    rateLimitLogger.info('Cleaned up old rate limit entries', { count });
  }

  return count;
}
