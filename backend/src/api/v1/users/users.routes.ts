/**
 * User Preferences API Routes
 *
 * Endpoints for managing user settings and preferences.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TABLES } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';

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

export default router;
