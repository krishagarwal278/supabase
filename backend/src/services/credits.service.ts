/**
 * Credits Service
 *
 * Manages user credits for video generation.
 */

import * as rolesService from './roles.service';
import {
  TABLES,
  CREDIT_COSTS,
  SUBSCRIPTION_PLANS,
  CREDIT_PACKAGES,
  USER_ROLES,
  INITIAL_CREDITS_BY_ROLE,
} from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { VideoFormat } from '@/types/api';
import type {
  UserCredits,
  CreditTransaction,
  CreditTransactionType,
  CreditsSummary,
  UserRoleType,
} from '@/types/models';

const creditsLogger = logger.child({ service: 'credits' });

// =============================================================================
// Error Codes for Frontend
// =============================================================================

export const CREDIT_ERROR_CODES = {
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  INVALID_PLAN: 'INVALID_PLAN',
  ALREADY_SUBSCRIBED: 'ALREADY_SUBSCRIBED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
} as const;

export interface InsufficientCreditsError {
  code: typeof CREDIT_ERROR_CODES.INSUFFICIENT_CREDITS;
  message: string;
  required: number;
  available: number;
  suggestedPackage: (typeof CREDIT_PACKAGES)[keyof typeof CREDIT_PACKAGES] | null;
}

// =============================================================================
// Credit Cost Calculation
// =============================================================================

/**
 * Get the credit cost for video generation based on format
 */
export function getVideoCreditCost(format: VideoFormat): number {
  switch (format) {
    case 'reel':
      return CREDIT_COSTS.VIDEO_GENERATION_REEL;
    case 'short_video':
      return CREDIT_COSTS.VIDEO_GENERATION_SHORT;
    case 'vfx_movie':
      return CREDIT_COSTS.VIDEO_GENERATION_VFX;
    case 'presentation':
      return CREDIT_COSTS.VIDEO_GENERATION_PRESENTATION;
    default:
      return CREDIT_COSTS.VIDEO_GENERATION_REEL;
  }
}

// =============================================================================
// User Credits Management
// =============================================================================

/**
 * Get or create user credits record
 * Now integrates with user roles for initial credit allocation
 */
export async function getUserCredits(userId: string, userEmail?: string): Promise<UserCredits> {
  const supabase = getServiceClient();

  // Try to get existing credits
  const { data: existing, error: fetchError } = await supabase
    .from(TABLES.USER_CREDITS)
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return existing as UserCredits;
  }

  // Create new credits record for new user
  if (fetchError?.code === 'PGRST116') {
    creditsLogger.info('Creating credits for new user', { userId });

    // Get user role to determine initial credits
    const role = await rolesService.getUserRole(userId, userEmail);
    const initialCredits = INITIAL_CREDITS_BY_ROLE[role];
    const planType = role === USER_ROLES.BETA_TESTER ? 'beta' : 'free';

    const { data: newCredits, error: createError } = await supabase
      .from(TABLES.USER_CREDITS)
      .insert({
        user_id: userId,
        total_credits: initialCredits,
        used_credits: 0,
        plan_type: planType,
      })
      .select()
      .single();

    if (createError) {
      throw new DatabaseError(`Failed to create user credits: ${createError.message}`);
    }

    // Record the initial credit bonus
    if (initialCredits > 0) {
      const description =
        role === USER_ROLES.BETA_TESTER
          ? 'Beta tester welcome credits'
          : role === USER_ROLES.ADMIN
            ? 'Admin credits'
            : 'Welcome bonus credits';
      await recordTransaction(userId, initialCredits, 'bonus_credits', description);
    }

    return newCredits as UserCredits;
  }

  if (fetchError) {
    throw new DatabaseError(`Failed to fetch user credits: ${fetchError.message}`);
  }

  throw new DatabaseError('Unexpected error fetching user credits');
}

/**
 * Get credits summary for a user (with role info)
 */
export async function getCreditsSummary(
  userId: string
): Promise<CreditsSummary & { role: UserRoleType }> {
  const credits = await getUserCredits(userId);
  const transactions = await getRecentTransactions(userId, 10);
  const role = await rolesService.getUserRole(userId);

  return {
    totalCredits: credits.total_credits,
    usedCredits: credits.used_credits,
    remainingCredits: credits.total_credits - credits.used_credits,
    planType: credits.plan_type,
    recentTransactions: transactions,
    role,
  };
}

/**
 * Check if user has enough credits
 */
export async function hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
  const credits = await getUserCredits(userId);
  return credits.total_credits - credits.used_credits >= amount;
}

/**
 * Deduct credits from user account
 */
export async function deductCredits(
  userId: string,
  amount: number,
  transactionType: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; remainingCredits: number }> {
  const supabase = getServiceClient();

  // Get current credits
  const credits = await getUserCredits(userId);
  const remaining = credits.total_credits - credits.used_credits;

  if (remaining < amount) {
    creditsLogger.warn('Insufficient credits', { userId, required: amount, remaining });
    return { success: false, remainingCredits: remaining };
  }

  // Update credits
  const { error: updateError } = await supabase
    .from(TABLES.USER_CREDITS)
    .update({
      used_credits: credits.used_credits + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    throw new DatabaseError(`Failed to deduct credits: ${updateError.message}`);
  }

  // Record transaction (negative amount for deduction)
  await recordTransaction(userId, -amount, transactionType, description, referenceId);

  creditsLogger.info('Credits deducted', { userId, amount, remaining: remaining - amount });

  return { success: true, remainingCredits: remaining - amount };
}

/**
 * Add credits to user account
 */
export async function addCredits(
  userId: string,
  amount: number,
  transactionType: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; newTotal: number }> {
  const supabase = getServiceClient();

  const credits = await getUserCredits(userId);

  const { error: updateError } = await supabase
    .from(TABLES.USER_CREDITS)
    .update({
      total_credits: credits.total_credits + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    throw new DatabaseError(`Failed to add credits: ${updateError.message}`);
  }

  await recordTransaction(userId, amount, transactionType, description, referenceId);

  creditsLogger.info('Credits added', { userId, amount, newTotal: credits.total_credits + amount });

  return { success: true, newTotal: credits.total_credits + amount };
}

// =============================================================================
// Credit Transactions
// =============================================================================

/**
 * Record a credit transaction
 */
async function recordTransaction(
  userId: string,
  amount: number,
  transactionType: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.CREDIT_TRANSACTIONS).insert({
    user_id: userId,
    amount,
    transaction_type: transactionType,
    description,
    reference_id: referenceId,
  });

  if (error) {
    creditsLogger.warn('Failed to record transaction', { error: error.message });
  }
}

/**
 * Get recent transactions for a user
 */
export async function getRecentTransactions(
  userId: string,
  limit: number = 10
): Promise<CreditTransaction[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.CREDIT_TRANSACTIONS)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DatabaseError(`Failed to fetch transactions: ${error.message}`);
  }

  return (data || []) as CreditTransaction[];
}

/**
 * Get all transactions for a user (paginated)
 */
export async function getTransactionHistory(
  userId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{ transactions: CreditTransaction[]; total: number }> {
  const supabase = getServiceClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from(TABLES.CREDIT_TRANSACTIONS)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new DatabaseError(`Failed to fetch transaction history: ${error.message}`);
  }

  return {
    transactions: (data || []) as CreditTransaction[],
    total: count || 0,
  };
}

// =============================================================================
// Admin Functions
// =============================================================================

/**
 * Check if a user is an admin (synchronous, env-based only)
 * For async check that includes database, use rolesService.isAdmin()
 */
export function isAdmin(userId: string, userEmail?: string): boolean {
  return rolesService.isEnvAdmin(userId, userEmail);
}

/**
 * Check if a user is an admin (async, includes database check)
 */
export async function isAdminAsync(userId: string, userEmail?: string): Promise<boolean> {
  return rolesService.isAdmin(userId, userEmail);
}

/**
 * Admin: Set credits for a user
 */
export async function adminSetCredits(
  adminUserId: string,
  targetUserId: string,
  totalCredits: number,
  reason: string
): Promise<UserCredits> {
  if (!isAdmin(adminUserId)) {
    throw new DatabaseError('Unauthorized: Admin access required');
  }

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.USER_CREDITS)
    .upsert({
      user_id: targetUserId,
      total_credits: totalCredits,
      used_credits: 0,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to set credits: ${error.message}`);
  }

  await recordTransaction(targetUserId, totalCredits, 'admin_adjustment', `Admin: ${reason}`);

  creditsLogger.info('Admin set credits', { adminUserId, targetUserId, totalCredits, reason });

  return data as UserCredits;
}

/**
 * Admin: Add credits to a user
 */
export async function adminAddCredits(
  adminUserId: string,
  targetUserId: string,
  amount: number,
  reason: string
): Promise<UserCredits> {
  if (!isAdmin(adminUserId)) {
    throw new DatabaseError('Unauthorized: Admin access required');
  }

  const credits = await getUserCredits(targetUserId);
  const newTotal = credits.total_credits + amount;

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.USER_CREDITS)
    .update({
      total_credits: newTotal,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', targetUserId)
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to add credits: ${error.message}`);
  }

  await recordTransaction(targetUserId, amount, 'admin_adjustment', `Admin added: ${reason}`);

  creditsLogger.info('Admin added credits', { adminUserId, targetUserId, amount, reason });

  return data as UserCredits;
}

/**
 * Admin: Get all users with credits info
 */
export async function adminGetAllUsers(
  adminUserId: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{ users: UserCredits[]; total: number }> {
  if (!isAdmin(adminUserId)) {
    throw new DatabaseError('Unauthorized: Admin access required');
  }

  const supabase = getServiceClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from(TABLES.USER_CREDITS)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new DatabaseError(`Failed to fetch users: ${error.message}`);
  }

  return {
    users: (data || []) as UserCredits[],
    total: count || 0,
  };
}

// =============================================================================
// Plans & Packages
// =============================================================================

/**
 * Get all available subscription plans
 */
export function getSubscriptionPlans() {
  return Object.values(SUBSCRIPTION_PLANS);
}

/**
 * Get a specific subscription plan
 */
export function getSubscriptionPlan(planId: string) {
  return SUBSCRIPTION_PLANS[planId as keyof typeof SUBSCRIPTION_PLANS] || null;
}

/**
 * Get all credit packages
 */
export function getCreditPackages() {
  return Object.values(CREDIT_PACKAGES);
}

/**
 * Get a specific credit package
 */
export function getCreditPackage(packageId: string) {
  const packages = CREDIT_PACKAGES as Record<
    string,
    (typeof CREDIT_PACKAGES)[keyof typeof CREDIT_PACKAGES]
  >;
  return Object.values(packages).find((pkg) => pkg.id === packageId) || null;
}

/**
 * Upgrade user plan
 */
export async function upgradePlan(
  userId: string,
  newPlanId: string
): Promise<{ success: boolean; credits: UserCredits }> {
  const plan = getSubscriptionPlan(newPlanId);

  if (!plan) {
    throw new DatabaseError(`Invalid plan: ${newPlanId}`);
  }

  const supabase = getServiceClient();
  const currentCredits = await getUserCredits(userId);

  // Add the plan's credits to existing
  const newTotal = currentCredits.total_credits + plan.credits;

  const { data, error } = await supabase
    .from(TABLES.USER_CREDITS)
    .update({
      total_credits: newTotal,
      plan_type: newPlanId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to upgrade plan: ${error.message}`);
  }

  await recordTransaction(userId, plan.credits, 'subscription', `Upgraded to ${plan.name} plan`);

  creditsLogger.info('User upgraded plan', { userId, newPlanId, creditsAdded: plan.credits });

  return { success: true, credits: data as UserCredits };
}

/**
 * Purchase credit package
 */
export async function purchaseCreditPackage(
  userId: string,
  packageId: string
): Promise<{ success: boolean; credits: UserCredits; creditsAdded: number }> {
  const pkg = getCreditPackage(packageId);

  if (!pkg) {
    throw new DatabaseError(`Invalid package: ${packageId}`);
  }

  const result = await addCredits(userId, pkg.credits, 'purchase', `Purchased ${pkg.name}`);

  creditsLogger.info('User purchased credits', { userId, packageId, creditsAdded: pkg.credits });

  return {
    success: result.success,
    credits: {
      user_id: userId,
      total_credits: result.newTotal,
      used_credits: 0,
      plan_type: 'free',
      created_at: '',
      updated_at: '',
    } as UserCredits,
    creditsAdded: pkg.credits,
  };
}

// =============================================================================
// Enhanced Credit Check with Detailed Error
// =============================================================================

/**
 * Check credits with detailed error information for frontend
 */
export async function checkCreditsWithDetails(
  userId: string,
  requiredAmount: number
): Promise<{
  hasEnough: boolean;
  required: number;
  available: number;
  planType: string;
  error?: InsufficientCreditsError;
}> {
  const credits = await getUserCredits(userId);
  const available = credits.total_credits - credits.used_credits;
  const hasEnough = available >= requiredAmount;

  if (hasEnough) {
    return {
      hasEnough: true,
      required: requiredAmount,
      available,
      planType: credits.plan_type,
    };
  }

  // Find the smallest package that covers the deficit
  const deficit = requiredAmount - available;
  const packages = getCreditPackages();
  const suggestedPackage =
    packages.filter((pkg) => pkg.credits >= deficit).sort((a, b) => a.price - b.price)[0] || null;

  return {
    hasEnough: false,
    required: requiredAmount,
    available,
    planType: credits.plan_type,
    error: {
      code: CREDIT_ERROR_CODES.INSUFFICIENT_CREDITS,
      message: `Insufficient credits. You need ${requiredAmount} credits but only have ${available}.`,
      required: requiredAmount,
      available,
      suggestedPackage,
    },
  };
}

// =============================================================================
// Refund Credits (for failed generations)
// =============================================================================

/**
 * Refund credits for a failed operation
 */
export async function refundCredits(
  userId: string,
  amount: number,
  referenceId: string,
  reason: string
): Promise<{ success: boolean; newBalance: number }> {
  const supabase = getServiceClient();
  const credits = await getUserCredits(userId);

  // Refund by reducing used_credits (not increasing total)
  const newUsed = Math.max(0, credits.used_credits - amount);

  const { error } = await supabase
    .from(TABLES.USER_CREDITS)
    .update({
      used_credits: newUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    throw new DatabaseError(`Failed to refund credits: ${error.message}`);
  }

  await recordTransaction(userId, amount, 'refund', reason, referenceId);

  creditsLogger.info('Credits refunded', { userId, amount, referenceId, reason });

  return {
    success: true,
    newBalance: credits.total_credits - newUsed,
  };
}
