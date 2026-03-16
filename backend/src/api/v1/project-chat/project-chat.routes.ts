/**
 * Project chat routes: GET/POST /api/v1/project/:projectId/chat
 * Persist project chat so conversation is restored when reopening a project.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { success } from '@/lib/response';
import { optionalAuth } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler } from '@/middleware/error-handler';
import { chatService, projectService } from '@/services';

const router = Router();

router.use(optionalAuth);

const projectChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
});

const replaceProjectChatSchema = z.object({
  messages: z.array(projectChatMessageSchema),
});

/**
 * GET /api/v1/project/:projectId/chat
 * Returns project chat messages for the scrollable conversation.
 * Auth: project must belong to the user (userId from JWT or query).
 */
router.get(
  '/:projectId/chat',
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = req.params['projectId'];
    const userId =
      (req as AuthenticatedRequest).userId ?? (req.query['userId'] as string | undefined);

    if (!userId) {
      throw new ValidationError('userId is required (from JWT or query)');
    }

    const project = await projectService.getProjectById(projectId);
    if (!project.user_id || project.user_id !== userId) {
      throw new NotFoundError('Project', projectId);
    }

    const messages = await chatService.getProjectChat(projectId, userId);
    return success(res, { messages });
  })
);

/**
 * POST /api/v1/project/:projectId/chat
 * Replace the project's chat history with the provided messages (full replace).
 * Auth: project must belong to the user.
 */
router.post(
  '/:projectId/chat',
  asyncHandler(async (req: Request, res: Response) => {
    const projectId = req.params['projectId'];
    const userId =
      (req as AuthenticatedRequest).userId ?? (req.query['userId'] as string | undefined);

    if (!userId) {
      throw new ValidationError('userId is required (from JWT or query)');
    }

    const project = await projectService.getProjectById(projectId);
    if (!project.user_id || project.user_id !== userId) {
      throw new NotFoundError('Project', projectId);
    }

    const parsed = replaceProjectChatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const messages = await chatService.replaceProjectChat(projectId, userId, parsed.data.messages);
    return success(res, { messages });
  })
);

export default router;
