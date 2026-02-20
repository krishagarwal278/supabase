/**
 * Generation History API Routes
 *
 * Endpoints for viewing generation history and statistics.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import * as historyService from '@/services/history.service';

const router = Router();

// Validation schemas
const userIdSchema = z.string().uuid();
const entryIdSchema = z.string().uuid();

/**
 * GET /api/v1/history
 * Get generation history for a user (all types)
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const pageSize = parseInt(req.query['pageSize'] as string, 10) || 20;
    const generationType = req.query['type'] as 'screenplay' | 'video' | 'enhancement' | undefined;
    const status = req.query['status'] as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | undefined;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const history = await historyService.getGenerationHistory(userId, {
      page,
      pageSize,
      generationType,
      status,
    });

    return success(res, {
      entries: history.entries,
      totalGenerations: history.totalGenerations,
      totalCreditsUsed: history.totalCreditsUsed,
      page,
      pageSize,
      totalPages: Math.ceil(history.totalGenerations / pageSize),
    });
  })
);

/**
 * GET /api/v1/history/videos
 * Get video generation history (for gallery view)
 */
router.get(
  '/videos',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const pageSize = parseInt(req.query['pageSize'] as string, 10) || 12;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const history = await historyService.getVideoHistory(userId, page, pageSize);

    return success(res, {
      videos: history.videos,
      total: history.total,
      hasMore: history.hasMore,
      page,
      pageSize,
    });
  })
);

/**
 * GET /api/v1/history/recent
 * Get recent generations for dashboard
 */
router.get(
  '/recent',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const limit = parseInt(req.query['limit'] as string, 10) || 5;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const recent = await historyService.getRecentGenerations(userId, limit);

    return success(res, { recent });
  })
);

/**
 * GET /api/v1/history/stats
 * Get generation statistics for a user
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const result = userIdSchema.safeParse(userId);
    if (!result.success) {
      throw new ValidationError('Invalid userId format');
    }

    const stats = await historyService.getGenerationStats(userId);

    return success(res, { stats });
  })
);

/**
 * GET /api/v1/history/:id
 * Get a single history entry
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const entryId = req.params['id'];

    const result = entryIdSchema.safeParse(entryId);
    if (!result.success) {
      throw new ValidationError('Invalid entry ID format');
    }

    const entry = await historyService.getHistoryEntry(entryId);

    if (!entry) {
      throw new ValidationError('History entry not found');
    }

    return success(res, { entry });
  })
);

export default router;
