/**
 * Credits API Routes
 *
 * Endpoints for managing user credits, plans, packages, and transaction history.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CREDIT_COSTS } from '@/config/constants';
import { ValidationError } from '@/lib/errors';
import { success, error as errorResponse } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import * as creditsService from '@/services/credits.service';

const router = Router();

// Validation schemas
const userIdSchema = z.string().uuid();

/**
 * GET /api/v1/credits
 * Get credits summary for a user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const summary = await creditsService.getCreditsSummary(userId);

    return success(res, { credits: summary });
  })
);

/**
 * GET /api/v1/credits/check
 * Check if user has enough credits for an operation (with detailed error info)
 */
router.get(
  '/check',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const amount = parseInt(req.query['amount'] as string, 10);

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    if (isNaN(amount) || amount < 0) {
      throw new ValidationError('Valid amount query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const checkResult = await creditsService.checkCreditsWithDetails(userId, amount);

    if (!checkResult.hasEnough && checkResult.error) {
      return errorResponse(
        res,
        checkResult.error.code,
        checkResult.error.message,
        402, // 402 Payment Required
        {
          required: checkResult.required,
          available: checkResult.available,
          planType: checkResult.planType,
          suggestedPackage: checkResult.error.suggestedPackage,
        }
      );
    }

    return success(res, {
      hasEnough: checkResult.hasEnough,
      required: checkResult.required,
      available: checkResult.available,
      planType: checkResult.planType,
    });
  })
);

/**
 * GET /api/v1/credits/transactions
 * Get transaction history for a user (paginated)
 */
router.get(
  '/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const pageSize = parseInt(req.query['pageSize'] as string, 10) || 20;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const history = await creditsService.getTransactionHistory(userId, page, pageSize);

    return success(res, {
      transactions: history.transactions,
      total: history.total,
      page,
      pageSize,
      totalPages: Math.ceil(history.total / pageSize),
    });
  })
);

/**
 * POST /api/v1/credits/add
 * Add credits to a user account (admin/purchase endpoint)
 */
router.post(
  '/add',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, amount, transactionType, description, referenceId } = req.body;

    if (!userId || !amount || !transactionType || !description) {
      throw new ValidationError('userId, amount, transactionType, and description are required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new ValidationError('Amount must be a positive number');
    }

    const addResult = await creditsService.addCredits(
      userId,
      amount,
      transactionType,
      description,
      referenceId
    );

    return success(res, {
      success: addResult.success,
      newTotal: addResult.newTotal,
      message: `Successfully added ${amount} credits`,
    });
  })
);

// =============================================================================
// Plans & Packages Endpoints
// =============================================================================

/**
 * GET /api/v1/credits/plans
 * Get all available subscription plans
 */
router.get(
  '/plans',
  asyncHandler(async (_req: Request, res: Response) => {
    const plans = creditsService.getSubscriptionPlans();

    return success(res, {
      plans,
      creditCosts: {
        screenplay: CREDIT_COSTS.SCREENPLAY_GENERATION,
        reel: CREDIT_COSTS.VIDEO_GENERATION_REEL,
        shortVideo: CREDIT_COSTS.VIDEO_GENERATION_SHORT,
        vfxMovie: CREDIT_COSTS.VIDEO_GENERATION_VFX,
        presentation: CREDIT_COSTS.VIDEO_GENERATION_PRESENTATION,
      },
    });
  })
);

/**
 * GET /api/v1/credits/packages
 * Get all available credit packages for purchase
 */
router.get(
  '/packages',
  asyncHandler(async (_req: Request, res: Response) => {
    const packages = creditsService.getCreditPackages();

    return success(res, { packages });
  })
);

/**
 * POST /api/v1/credits/upgrade
 * Upgrade user's subscription plan
 */
router.post(
  '/upgrade',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, planId } = req.body;

    if (!userId || !planId) {
      throw new ValidationError('userId and planId are required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const plan = creditsService.getSubscriptionPlan(planId);
    if (!plan) {
      throw new ValidationError(
        `Invalid plan: ${planId}. Valid plans: free, starter, pro, enterprise`
      );
    }

    const upgradeResult = await creditsService.upgradePlan(userId, planId);

    return success(res, {
      success: upgradeResult.success,
      plan: plan,
      credits: {
        totalCredits: upgradeResult.credits.total_credits,
        usedCredits: upgradeResult.credits.used_credits,
        remainingCredits: upgradeResult.credits.total_credits - upgradeResult.credits.used_credits,
        planType: upgradeResult.credits.plan_type,
      },
      message: `Successfully upgraded to ${plan.name} plan! ${plan.credits} credits added.`,
    });
  })
);

/**
 * POST /api/v1/credits/purchase
 * Purchase a credit package
 */
router.post(
  '/purchase',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, packageId } = req.body;

    if (!userId || !packageId) {
      throw new ValidationError('userId and packageId are required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const pkg = creditsService.getCreditPackage(packageId);
    if (!pkg) {
      throw new ValidationError(`Invalid package: ${packageId}`);
    }

    const purchaseResult = await creditsService.purchaseCreditPackage(userId, packageId);
    const summary = await creditsService.getCreditsSummary(userId);

    return success(res, {
      success: purchaseResult.success,
      package: pkg,
      creditsAdded: purchaseResult.creditsAdded,
      credits: summary,
      message: `Successfully purchased ${pkg.name}! ${pkg.credits} credits added.`,
    });
  })
);

// =============================================================================
// Admin Endpoints
// =============================================================================

/**
 * GET /api/v1/credits/admin/users
 * Get all users with their credit info (admin only)
 */
router.get(
  '/admin/users',
  asyncHandler(async (req: Request, res: Response) => {
    const adminUserId = req.query['adminUserId'] as string;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const pageSize = parseInt(req.query['pageSize'] as string, 10) || 50;

    if (!adminUserId) {
      throw new ValidationError('adminUserId query parameter is required');
    }

    const result = userIdSchema.safeParse(adminUserId);
    if (!result.success) {
      throw new ValidationError('Invalid adminUserId format');
    }

    if (!creditsService.isAdmin(adminUserId)) {
      return errorResponse(res, 'UNAUTHORIZED', 'Admin access required', 403);
    }

    const users = await creditsService.adminGetAllUsers(adminUserId, page, pageSize);

    return success(res, {
      users: users.users.map((u) => ({
        userId: u.user_id,
        totalCredits: u.total_credits,
        usedCredits: u.used_credits,
        remainingCredits: u.total_credits - u.used_credits,
        planType: u.plan_type,
        createdAt: u.created_at,
      })),
      total: users.total,
      page,
      pageSize,
      totalPages: Math.ceil(users.total / pageSize),
    });
  })
);

/**
 * POST /api/v1/credits/admin/set
 * Set credits for a user (admin only)
 */
router.post(
  '/admin/set',
  asyncHandler(async (req: Request, res: Response) => {
    const { adminUserId, targetUserId, totalCredits, reason } = req.body;

    if (!adminUserId || !targetUserId || totalCredits === undefined || !reason) {
      throw new ValidationError('adminUserId, targetUserId, totalCredits, and reason are required');
    }

    const adminResult = userIdSchema.safeParse(adminUserId);
    const targetResult = userIdSchema.safeParse(targetUserId);

    if (!adminResult.success || !targetResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    if (!creditsService.isAdmin(adminUserId)) {
      return errorResponse(res, 'UNAUTHORIZED', 'Admin access required', 403);
    }

    const credits = await creditsService.adminSetCredits(
      adminUserId,
      targetUserId,
      totalCredits,
      reason
    );

    return success(res, {
      success: true,
      targetUserId,
      credits: {
        totalCredits: credits.total_credits,
        usedCredits: credits.used_credits,
        remainingCredits: credits.total_credits - credits.used_credits,
        planType: credits.plan_type,
      },
      message: `Successfully set ${totalCredits} credits for user`,
    });
  })
);

/**
 * POST /api/v1/credits/admin/add
 * Add credits to a user (admin only)
 */
router.post(
  '/admin/add',
  asyncHandler(async (req: Request, res: Response) => {
    const { adminUserId, targetUserId, amount, reason } = req.body;

    if (!adminUserId || !targetUserId || !amount || !reason) {
      throw new ValidationError('adminUserId, targetUserId, amount, and reason are required');
    }

    const adminResult = userIdSchema.safeParse(adminUserId);
    const targetResult = userIdSchema.safeParse(targetUserId);

    if (!adminResult.success || !targetResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    if (!creditsService.isAdmin(adminUserId)) {
      return errorResponse(res, 'UNAUTHORIZED', 'Admin access required', 403);
    }

    const credits = await creditsService.adminAddCredits(adminUserId, targetUserId, amount, reason);

    return success(res, {
      success: true,
      targetUserId,
      creditsAdded: amount,
      credits: {
        totalCredits: credits.total_credits,
        usedCredits: credits.used_credits,
        remainingCredits: credits.total_credits - credits.used_credits,
        planType: credits.plan_type,
      },
      message: `Successfully added ${amount} credits to user`,
    });
  })
);

export default router;
