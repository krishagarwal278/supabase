/**
 * Chat Routes
 *
 * AI ideation and chat message persistence for projects.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import { chatService } from '@/services';

const router = Router();

// =============================================================================
// Schemas
// =============================================================================

const ideateSchema = z.object({
  message: z.string().min(1).max(2000),
  userId: z.string().min(1),
  format: z.string().optional(),
  context: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional(),
});

const saveMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
  screenplayVersion: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// Ideation Endpoints
// =============================================================================

/**
 * POST /api/v1/chat/ideate
 * AI-powered brainstorming for video ideas
 */
router.post(
  '/ideate',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = ideateSchema.safeParse(req.body);

    if (!validated.success) {
      throw new ValidationError(validated.error.message);
    }

    const { message, userId, format, context } = validated.data;

    // Generate ideation response
    const ideation = await chatService.generateIdeation(message, {
      format,
      previousMessages: context,
    });

    // Optionally save messages (for ideation history without a project)
    await chatService.saveMessage({
      userId,
      role: 'user',
      content: message,
    });

    await chatService.saveMessage({
      userId,
      role: 'assistant',
      content: ideation.response,
      metadata: { suggestions: ideation.suggestions },
    });

    return success(res, {
      response: ideation.response,
      suggestions: ideation.suggestions,
    });
  })
);

// =============================================================================
// Project Chat Endpoints
// =============================================================================

/**
 * GET /api/v1/chat/:projectId/messages
 * Get chat history for a project
 */
router.get(
  '/:projectId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const userId = req.query['userId'] as string;
    const limit = parseInt(req.query['limit'] as string) || 50;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const messages = await chatService.getProjectMessages(projectId, userId, limit);

    return success(res, { messages });
  })
);

/**
 * POST /api/v1/chat/:projectId/messages
 * Save a chat message for a project
 */
router.post(
  '/:projectId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const validated = saveMessageSchema.safeParse(req.body);

    if (!validated.success) {
      throw new ValidationError(validated.error.message);
    }

    const message = await chatService.saveMessage({
      projectId,
      userId,
      ...validated.data,
    });

    return success(res, { message });
  })
);

/**
 * DELETE /api/v1/chat/:projectId/messages
 * Clear chat history for a project
 */
router.delete(
  '/:projectId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;

    await chatService.deleteProjectMessages(projectId);

    return success(res, { message: 'Messages deleted successfully' });
  })
);

// =============================================================================
// Ideation History (no project)
// =============================================================================

/**
 * GET /api/v1/chat/ideation/history
 * Get recent ideation chat history
 */
router.get(
  '/ideation/history',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    const limit = parseInt(req.query['limit'] as string) || 20;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const messages = await chatService.getIdeationMessages(userId, limit);

    return success(res, { messages });
  })
);

export default router;
