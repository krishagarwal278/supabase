/**
 * Video Routes
 *
 * Video generation and screenplay operations.
 */

import { Router, Request, Response } from 'express';
import { ValidationError } from '@/lib/errors';
import { success } from '@/lib/response';
import { asyncHandler } from '@/middleware/error-handler';
import {
  videoService,
  projectService,
  chatService,
  falVideoService,
  storageService,
  slideshowService,
} from '@/services';
import {
  videoGenerationRequestSchema,
  enhanceScreenplayRequestSchema,
  generateVideoRequestSchema,
  falVideoRequestSchema,
  falImageToVideoRequestSchema,
  slideshowRequestSchema,
  previewSlideshowRequestSchema,
  uuidSchema,
} from '@/types/api';
import type { RateLimitInfo } from '@/types/models';

const router = Router();

/**
 * Helper to set rate limit headers on response
 */
function setRateLimitHeaders(res: Response, info?: RateLimitInfo): void {
  if (info) {
    res.setHeader('X-RateLimit-Limit', info.limit);
    res.setHeader('X-RateLimit-Remaining', info.remaining);
    res.setHeader('X-RateLimit-Reset', info.reset);
  }
}

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

    // Set rate limit headers
    setRateLimitHeaders(res, result.rateLimitInfo);

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

    // Extract userId from body if provided (for version tracking)
    const userId = req.body.userId as string | undefined;

    const result = await videoService.enhanceScreenplay({
      ...validated.data,
      userId,
    });

    return success(res, {
      screenplay: result.screenplay,
      version: result.version,
      message: 'Screenplay enhanced successfully',
    });
  })
);

/**
 * POST /api/v1/video/generate-video
 * Generate actual video from screenplay
 * Includes credit check and rate limiting
 */
router.post(
  '/generate-video',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = generateVideoRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const result = await videoService.generateVideo(validated.data);

    // Set rate limit headers
    setRateLimitHeaders(res, result.rateLimitInfo);

    // Also include credits info in header
    res.setHeader('X-Credits-Remaining', result.remainingCredits);

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
      creditsUsed: result.creditsUsed,
      remainingCredits: result.remainingCredits,
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
 * GET /api/v1/video/project/:id/screenplays
 * Get screenplays for a specific project
 */
router.get(
  '/project/:id/screenplays',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const screenplays = await videoService.getProjectScreenplays(idResult.data);

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

// =============================================================================
// Screenplay Versioning
// =============================================================================

/**
 * GET /api/v1/video/project/:id/versions
 * Get all screenplay versions for a project
 */
router.get(
  '/project/:id/versions',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const versions = await chatService.getScreenplayVersions(idResult.data);

    return success(res, { versions });
  })
);

/**
 * GET /api/v1/video/project/:id/versions/:version
 * Get a specific screenplay version
 */
router.get(
  '/project/:id/versions/:version',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);
    const version = parseInt(req.params['version']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    if (isNaN(version) || version < 1) {
      throw new ValidationError('Invalid version number');
    }

    const versionData = await chatService.getScreenplayVersion(idResult.data, version);

    if (!versionData) {
      throw new ValidationError('Version not found');
    }

    return success(res, versionData);
  })
);

// =============================================================================
// Fal AI Direct Video Generation (Backend Proxy)
// =============================================================================

/**
 * POST /api/v1/video/generate-fal
 * Generate video from text prompt using fal.ai
 * This is a backend proxy to keep API keys secure
 * Videos are saved to Supabase Storage for persistence (fal.ai URLs expire)
 */
router.post(
  '/generate-fal',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = falVideoRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const { prompt, duration, aspectRatio, model, userId } = validated.data;

    const result = await falVideoService.generateTextToVideo(prompt, {
      duration,
      aspectRatio,
      model,
    });

    if (!result.success || !result.videoUrl) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    // Save video to Supabase Storage for persistence
    // fal.ai URLs are temporary and expire quickly
    try {
      const { storageUrl, storagePath } = await storageService.saveVideoFromUrl(result.videoUrl, {
        userId,
        folder: 'fal-videos',
      });

      return success(res, {
        videoUrl: storageUrl,
        originalUrl: result.videoUrl,
        storagePath,
        requestId: result.requestId,
      });
    } catch (storageError) {
      // If storage fails, still return the original URL (it may work briefly)
      console.error('Failed to save video to storage:', storageError);
      return success(res, {
        videoUrl: result.videoUrl,
        requestId: result.requestId,
        warning: 'Video saved to temporary URL only. Download immediately as it will expire.',
      });
    }
  })
);

/**
 * POST /api/v1/video/generate-fal-image
 * Generate video from image using fal.ai (image-to-video)
 * This is a backend proxy to keep API keys secure
 * Videos are saved to Supabase Storage for persistence (fal.ai URLs expire)
 */
router.post(
  '/generate-fal-image',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = falImageToVideoRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const { prompt, imageUrl, model, userId } = validated.data;

    const result = await falVideoService.generateImageToVideo(prompt, imageUrl, {
      model,
    });

    if (!result.success || !result.videoUrl) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    // Save video to Supabase Storage for persistence
    try {
      const { storageUrl, storagePath } = await storageService.saveVideoFromUrl(result.videoUrl, {
        userId,
        folder: 'fal-videos',
      });

      return success(res, {
        videoUrl: storageUrl,
        originalUrl: result.videoUrl,
        storagePath,
        requestId: result.requestId,
      });
    } catch (storageError) {
      console.error('Failed to save video to storage:', storageError);
      return success(res, {
        videoUrl: result.videoUrl,
        requestId: result.requestId,
        warning: 'Video saved to temporary URL only. Download immediately as it will expire.',
      });
    }
  })
);

// =============================================================================
// Slideshow Generation (Recommended for Course Content)
// =============================================================================

/**
 * POST /api/v1/video/generate-slideshow
 * Generate a slideshow from document content
 * Creates professional slides with AI-generated backgrounds
 */
router.post(
  '/generate-slideshow',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = slideshowRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const result = await slideshowService.generateSlideshow(validated.data);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    return success(res, {
      slides: result.slides,
      totalDuration: result.totalDuration,
      slideCount: result.slides.length,
    });
  })
);

/**
 * POST /api/v1/video/generate-slideshow-preview
 * Generate a quick preview slideshow (fewer slides, faster)
 * Good for testing before full generation
 */
router.post(
  '/generate-slideshow-preview',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = previewSlideshowRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const { content, style, userId } = validated.data;

    const result = await slideshowService.generatePreviewSlideshow(content, {
      userId,
      style,
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    return success(res, {
      slides: result.slides,
      totalDuration: result.totalDuration,
      slideCount: result.slides.length,
      isPreview: true,
    });
  })
);

export default router;
