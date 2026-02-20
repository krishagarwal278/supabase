/**
 * User API Routes
 *
 * Endpoints for managing user settings, preferences, account, and billing.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  TABLES,
  MVP_CONFIG,
  SUBSCRIPTION_PLANS,
  CREDIT_PACKAGES,
  CREDIT_COSTS,
} from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import * as creditsService from '@/services/credits.service';

const router = Router();
const userLogger = logger.child({ service: 'users' });

// Validation schemas
const userIdSchema = z.string().uuid();

const preferencesSchema = z.object({
  defaultModel: z.string().optional(),
  defaultFormat: z.enum(['reel', 'short_video', 'vfx_movie', 'presentation']).optional(),
  defaultDuration: z.number().min(15).max(600).optional(),
  voiceoverEnabled: z.boolean().optional(),
  captionsEnabled: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().max(10).optional(),
  emailNotifications: z.boolean().optional(),
  generationAlerts: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
});

/**
 * Default preferences for new users
 */
const DEFAULT_PREFERENCES = {
  defaultModel: 'gpt-4o',
  defaultFormat: 'reel',
  defaultDuration: 60,
  voiceoverEnabled: true,
  captionsEnabled: true,
  theme: 'dark',
  language: 'en',
  emailNotifications: true,
  generationAlerts: true,
  weeklyDigest: false,
};

/**
 * Convert database row to API response format
 */
function dbToApiFormat(data: Record<string, unknown>) {
  return {
    defaultModel: data.default_model,
    defaultFormat: data.default_format,
    defaultDuration: data.default_duration,
    voiceoverEnabled: data.voiceover_enabled,
    captionsEnabled: data.captions_enabled,
    theme: data.theme,
    language: data.language,
    emailNotifications: data.email_notifications,
    generationAlerts: data.generation_alerts,
    weeklyDigest: data.weekly_digest,
  };
}

/**
 * Convert API request to database format
 */
function apiToDbFormat(preferences: z.infer<typeof preferencesSchema>) {
  const dbData: Record<string, unknown> = {};

  if (preferences.defaultModel !== undefined) {
    dbData.default_model = preferences.defaultModel;
  }
  if (preferences.defaultFormat !== undefined) {
    dbData.default_format = preferences.defaultFormat;
  }
  if (preferences.defaultDuration !== undefined) {
    dbData.default_duration = preferences.defaultDuration;
  }
  if (preferences.voiceoverEnabled !== undefined) {
    dbData.voiceover_enabled = preferences.voiceoverEnabled;
  }
  if (preferences.captionsEnabled !== undefined) {
    dbData.captions_enabled = preferences.captionsEnabled;
  }
  if (preferences.theme !== undefined) {
    dbData.theme = preferences.theme;
  }
  if (preferences.language !== undefined) {
    dbData.language = preferences.language;
  }
  if (preferences.emailNotifications !== undefined) {
    dbData.email_notifications = preferences.emailNotifications;
  }
  if (preferences.generationAlerts !== undefined) {
    dbData.generation_alerts = preferences.generationAlerts;
  }
  if (preferences.weeklyDigest !== undefined) {
    dbData.weekly_digest = preferences.weeklyDigest;
  }

  return dbData;
}

/**
 * GET /api/v1/users/preferences
 * Get user preferences
 */
router.get(
  '/preferences',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from(TABLES.USER_PREFERENCES)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // PGRST116 means no rows found - return defaults
      if (error.code === 'PGRST116') {
        userLogger.debug('No preferences found, returning defaults', { userId });
        return success(res, { preferences: DEFAULT_PREFERENCES });
      }
      throw new DatabaseError(`Failed to fetch preferences: ${error.message}`);
    }

    const preferences = dbToApiFormat(data);
    userLogger.debug('Preferences fetched', { userId });

    return success(res, { preferences });
  })
);

/**
 * PUT /api/v1/users/preferences
 * Update user preferences (creates if doesn't exist)
 */
router.put(
  '/preferences',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, preferences } = req.body;

    if (!userId) {
      throw new ValidationError('userId is required in request body');
    }

    const userIdResult = userIdSchema.safeParse(userId);
    if (!userIdResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    if (!preferences || typeof preferences !== 'object') {
      throw new ValidationError('preferences object is required');
    }

    const parseResult = preferencesSchema.safeParse(preferences);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid preferences: ${parseResult.error.message}`);
    }

    const dbData = apiToDbFormat(parseResult.data);
    const supabase = getServiceClient();

    // Upsert: insert if doesn't exist, update if exists
    const { data, error } = await supabase
      .from(TABLES.USER_PREFERENCES)
      .upsert(
        {
          user_id: userId,
          ...dbData,
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      throw new DatabaseError(`Failed to update preferences: ${error.message}`);
    }

    const updatedPreferences = dbToApiFormat(data);
    userLogger.info('Preferences updated', { userId });

    return success(res, { preferences: updatedPreferences });
  })
);

/**
 * DELETE /api/v1/users/preferences
 * Reset user preferences to defaults
 */
router.delete(
  '/preferences',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    const supabase = getServiceClient();

    const { error } = await supabase.from(TABLES.USER_PREFERENCES).delete().eq('user_id', userId);

    if (error) {
      throw new DatabaseError(`Failed to delete preferences: ${error.message}`);
    }

    userLogger.info('Preferences reset to defaults', { userId });

    return success(res, {
      message: 'Preferences reset to defaults',
      preferences: DEFAULT_PREFERENCES,
    });
  })
);

// =============================================================================
// ACCOUNT & BILLING ENDPOINTS
// =============================================================================

/**
 * GET /api/v1/users/account
 * Get complete account info including credits, plan, and usage
 */
router.get(
  '/account',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    // Get credits summary
    const creditsSummary = await creditsService.getCreditsSummary(userId);

    // Calculate videos remaining
    const videosRemaining = Math.floor(
      creditsSummary.remainingCredits / CREDIT_COSTS.VIDEO_GENERATION_REEL
    );
    const videosUsed = Math.floor(creditsSummary.usedCredits / CREDIT_COSTS.VIDEO_GENERATION_REEL);

    // Get current plan details
    const currentPlan =
      SUBSCRIPTION_PLANS[creditsSummary.planType as keyof typeof SUBSCRIPTION_PLANS] ||
      SUBSCRIPTION_PLANS.free;

    return success(res, {
      account: {
        planType: creditsSummary.planType,
        planName: currentPlan.name,
        isBetaUser: MVP_CONFIG.IS_BETA_MODE,

        // Credits info
        credits: {
          total: creditsSummary.totalCredits,
          used: creditsSummary.usedCredits,
          remaining: creditsSummary.remainingCredits,
        },

        // Videos info (user-friendly)
        videos: {
          total: Math.floor(creditsSummary.totalCredits / CREDIT_COSTS.VIDEO_GENERATION_REEL),
          used: videosUsed,
          remaining: videosRemaining,
        },

        // Usage limits
        limits: {
          maxVideosPerPeriod: MVP_CONFIG.MAX_VIDEOS_PER_PERIOD,
          periodDays: MVP_CONFIG.BETA_PERIOD_DAYS,
          creditsPerVideo: MVP_CONFIG.CREDITS_PER_VIDEO,
        },

        // Recent transactions
        recentTransactions: creditsSummary.recentTransactions.slice(0, 5),
      },
    });
  })
);

/**
 * GET /api/v1/users/billing
 * Get billing info and available plans/packages
 */
router.get(
  '/billing',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    // Get current credits
    const creditsSummary = await creditsService.getCreditsSummary(userId);
    const currentPlan =
      SUBSCRIPTION_PLANS[creditsSummary.planType as keyof typeof SUBSCRIPTION_PLANS] ||
      SUBSCRIPTION_PLANS.free;

    // Format plans for frontend
    const availablePlans = Object.values(SUBSCRIPTION_PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      videosIncluded: plan.videosIncluded,
      credits: plan.credits,
      features: plan.features,
      limitations: plan.limitations,
      popular: 'popular' in plan ? plan.popular : false,
      isCurrent: plan.id === creditsSummary.planType,
    }));

    // Format packages for frontend
    const availablePackages = Object.values(CREDIT_PACKAGES).map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      videos: pkg.videos,
      credits: pkg.credits,
      price: pkg.price,
      pricePerVideo: pkg.pricePerVideo,
      savings: pkg.savings,
      popular: 'popular' in pkg ? pkg.popular : false,
    }));

    return success(res, {
      billing: {
        currentPlan: {
          id: currentPlan.id,
          name: currentPlan.name,
          price: currentPlan.price,
        },
        credits: {
          total: creditsSummary.totalCredits,
          remaining: creditsSummary.remainingCredits,
          videosRemaining: Math.floor(
            creditsSummary.remainingCredits / CREDIT_COSTS.VIDEO_GENERATION_REEL
          ),
        },

        // Available upgrades
        plans: availablePlans,
        packages: availablePackages,

        // Credit costs (for display)
        creditCosts: {
          video: CREDIT_COSTS.VIDEO_GENERATION_REEL,
          screenplay: CREDIT_COSTS.SCREENPLAY_GENERATION,
        },

        // MVP/Beta info
        isBetaMode: MVP_CONFIG.IS_BETA_MODE,
        betaMessage: MVP_CONFIG.IS_BETA_MODE
          ? "You're part of our beta program! Payments are disabled during beta."
          : null,
      },
    });
  })
);

/**
 * POST /api/v1/users/billing/purchase
 * Purchase a credit package (placeholder for Stripe/Square integration)
 */
router.post(
  '/billing/purchase',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, packageId } = req.body;

    if (!userId || !packageId) {
      throw new ValidationError('userId and packageId are required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    // Check if in beta mode
    if (MVP_CONFIG.IS_BETA_MODE) {
      return success(res, {
        success: false,
        message: 'Payments are disabled during beta. Contact support for more credits.',
        isBetaMode: true,
        // In production, this would redirect to Stripe/Square checkout
        checkoutUrl: null,
      });
    }

    // Validate package
    const pkg = Object.values(CREDIT_PACKAGES).find((p) => p.id === packageId);
    if (!pkg) {
      throw new ValidationError(`Invalid package: ${packageId}`);
    }

    // TODO: Integrate with Stripe/Square
    // For now, return placeholder for payment flow
    return success(res, {
      success: true,
      message: 'Payment integration coming soon',
      package: {
        id: pkg.id,
        name: pkg.name,
        price: pkg.price,
        credits: pkg.credits,
      },
      // These would be populated by Stripe/Square
      checkoutUrl: null,
      sessionId: null,
      paymentProvider: null, // 'stripe' | 'square'
    });
  })
);

/**
 * POST /api/v1/users/billing/subscribe
 * Subscribe to a plan (placeholder for Stripe/Square integration)
 */
router.post(
  '/billing/subscribe',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, planId } = req.body;

    if (!userId || !planId) {
      throw new ValidationError('userId and planId are required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    // Check if in beta mode
    if (MVP_CONFIG.IS_BETA_MODE) {
      return success(res, {
        success: false,
        message: 'Subscriptions are disabled during beta. You have access to all features!',
        isBetaMode: true,
        checkoutUrl: null,
      });
    }

    // Validate plan
    const plan = SUBSCRIPTION_PLANS[planId as keyof typeof SUBSCRIPTION_PLANS];
    if (!plan) {
      throw new ValidationError(`Invalid plan: ${planId}`);
    }

    // TODO: Integrate with Stripe/Square
    return success(res, {
      success: true,
      message: 'Subscription integration coming soon',
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
      },
      checkoutUrl: null,
      sessionId: null,
      paymentProvider: null,
    });
  })
);

/**
 * GET /api/v1/users/usage
 * Get detailed usage statistics
 */
router.get(
  '/usage',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const period = (req.query['period'] as string) || '30d'; // 7d, 30d, all

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const parseResult = userIdSchema.safeParse(userId);
    if (!parseResult.success) {
      throw new ValidationError('Invalid userId format');
    }

    const supabase = getServiceClient();

    // Calculate date range
    let startDate: Date | null = null;
    if (period === '7d') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get generation history
    let query = supabase
      .from(TABLES.GENERATION_HISTORY)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }

    const { data: generations, error } = await query;

    if (error) {
      throw new DatabaseError(`Failed to fetch usage: ${error.message}`);
    }

    const entries = generations || [];

    // Calculate stats
    const videosGenerated = entries.filter((e) => e.generation_type === 'video').length;
    const screenplaysGenerated = entries.filter((e) => e.generation_type === 'screenplay').length;
    const creditsUsed = entries.reduce((sum, e) => sum + (e.credits_used || 0), 0);
    const successfulVideos = entries.filter(
      (e) => e.generation_type === 'video' && e.status === 'completed'
    ).length;
    const failedVideos = entries.filter(
      (e) => e.generation_type === 'video' && e.status === 'failed'
    ).length;

    return success(res, {
      usage: {
        period,
        videosGenerated,
        screenplaysGenerated,
        creditsUsed,
        successRate:
          videosGenerated > 0 ? Math.round((successfulVideos / videosGenerated) * 100) : 100,

        breakdown: {
          completed: successfulVideos,
          failed: failedVideos,
          pending: entries.filter((e) => e.status === 'pending' || e.status === 'processing')
            .length,
        },

        // Recent activity
        recentGenerations: entries.slice(0, 10).map((e) => ({
          id: e.id,
          type: e.generation_type,
          status: e.status,
          format: e.format,
          creditsUsed: e.credits_used,
          createdAt: e.created_at,
          projectName: e.project_name,
        })),
      },
    });
  })
);

export default router;
