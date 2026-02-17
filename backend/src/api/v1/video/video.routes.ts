/**
 * Video Routes
 *
 * Video generation and screenplay operations.
 */

import { Router, Request, Response } from 'express';
import { ValidationError } from '@/lib/errors';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import { videoService, projectService } from '@/services';
import {
  videoGenerationRequestSchema,
  enhanceScreenplayRequestSchema,
  generateVideoRequestSchema,
  uuidSchema,
} from '@/types/api';

const router = Router();

/**
 * POST /api/v1/video/generate
 * Generate a screenplay for a video
 */
router.post(
  '/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = videoGenerationRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const result = await videoService.generateScreenplay(validated.data);

    return success(res, {
      projectId: result.projectId,
      screenplay: result.screenplay,
      status: result.status,
      message: result.message,
      estimatedCompletionTime: result.estimatedCompletionTime,
    });
  })
);

/**
 * POST /api/v1/video/enhance-screenplay
 * Enhance an existing screenplay with feedback
 */
router.post(
  '/enhance-screenplay',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = enhanceScreenplayRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const result = await videoService.enhanceScreenplay(validated.data);

    return success(res, {
      screenplay: result.screenplay,
      message: 'Screenplay enhanced successfully',
    });
  })
);

/**
 * POST /api/v1/video/generate-video
 * Generate actual video from screenplay
 */
router.post(
  '/generate-video',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = generateVideoRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const result = await videoService.generateVideo(validated.data);

    return success(res, {
      message:
        result.status === 'completed'
          ? `Video generated successfully! ${result.clipCount} clips created.`
          : 'Video generation in progress',
      status: result.status,
      projectId: validated.data.projectId,
      videoId: result.videoId,
      videoUrl: result.videoUrl,
      videoUrls: result.videoUrls,
      clipCount: result.clipCount,
      progress: result.progress,
    });
  })
);

/**
 * GET /api/v1/video/status/:videoId
 * Check video generation status
 */
router.get(
  '/status/:videoId',
  asyncHandler(async (req: Request, res: Response) => {
    const { videoId } = req.params;

    if (!videoId) {
      throw new ValidationError('Video ID is required');
    }

    const result = await videoService.checkVideoStatus(videoId);

    return success(res, result);
  })
);

/**
 * GET /api/v1/video/project/:id
 * Get a video project by ID
 */
router.get(
  '/project/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const project = await projectService.getProjectById(idResult.data);

    return success(res, { project });
  })
);

/**
 * GET /api/v1/video/projects
 * Get all video projects for a user
 */
router.get(
  '/projects',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;

    if (!userId) {
      throw new ValidationError('userId query parameter is required');
    }

    const { projects } = await projectService.getProjects({ userId });

    return success(res, { projects });
  })
);

/**
 * GET /api/v1/video/screenplays
 * Get all screenplays
 */
router.get(
  '/screenplays',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.query['userId'] as string | undefined;

    const screenplays = await videoService.getScreenplays(userId);

    return success(res, { screenplays });
  })
);

/**
 * DELETE /api/v1/video/project/:id
 * Delete a video project
 */
router.delete(
  '/project/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    await projectService.deleteProject(idResult.data);

    return success(res, { message: 'Project deleted successfully' });
  })
);

export default router;
