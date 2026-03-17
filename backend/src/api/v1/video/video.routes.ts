/**
 * Video Routes
 *
 * Video generation and screenplay operations.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ValidationError } from '@/lib/errors';
import {
  getIdempotentResponse,
  setIdempotentResponse,
  setIdempotentProcessing,
} from '@/lib/idempotency';
import { success } from '@/lib/response';
import { optionalAuth } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler } from '@/middleware/error-handler';
import {
  videoService,
  projectService,
  chatService,
  falVideoService,
  storageService,
  slideshowService,
  slideshowExportService,
} from '@/services';
import { extractTextFromDocument } from '@/services/document-extraction.service';
import {
  videoGenerationRequestSchema,
  enhanceScreenplayRequestSchema,
  generateVideoRequestSchema,
  falVideoRequestSchema,
  falImageToVideoRequestSchema,
  slideshowRequestSchema,
  previewSlideshowRequestSchema,
  exportSlideshowRequestSchema,
  uuidSchema,
} from '@/types/api';
import type { RateLimitInfo } from '@/types/models';

const router = Router();

/** Prefer JWT userId when present; all video routes get optional auth context */
router.use(optionalAuth);

/** Multer memory storage for document upload (max 15MB for strategy docs) */
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('document');

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
 * Includes credit check and rate limiting. Supports idempotencyKey to avoid duplicate charges on retries.
 */
router.post(
  '/generate-video',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = generateVideoRequestSchema.safeParse(req.body);

    if (!validated.success) {
      throw validated.error;
    }

    const idempotencyKey = validated.data.idempotencyKey;
    if (idempotencyKey) {
      const cached = getIdempotentResponse<{
        message?: string;
        status?: string;
        projectId?: string;
        videoId?: string;
        videoUrl?: string;
        videoUrls?: string[];
        clipCount?: number;
        progress?: number;
        creditsUsed?: number;
        remainingCredits?: number;
        success?: boolean;
        error?: string;
      }>(idempotencyKey);
      if (cached) {
        if (cached.status === 'processing') {
          return res.status(409).json({
            success: false,
            error:
              'Duplicate request; previous request still in progress. Use the same idempotency key when retrying.',
          });
        }
        if (cached.status === 'failed') {
          const errBody = cached.response as { success?: boolean; error?: string };
          return res.status(503).json({
            success: false,
            error: errBody?.error ?? 'Video generation failed previously.',
          });
        }
        setRateLimitHeaders(res);
        return success(res, cached.response);
      }
      if (!setIdempotentProcessing(idempotencyKey)) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate idempotency key.',
        });
      }
    }

    let result;
    try {
      result = await videoService.generateVideo(validated.data);
    } catch (err) {
      if (idempotencyKey) {
        const message = err instanceof Error ? err.message : 'Video generation failed';
        setIdempotentResponse(idempotencyKey, 'failed', { success: false, error: message });
      }
      throw err;
    }

    // Set rate limit headers
    setRateLimitHeaders(res, result.rateLimitInfo);

    // Also include credits info in header
    res.setHeader('X-Credits-Remaining', result.remainingCredits);

    const payload = {
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
    };
    if (idempotencyKey) {
      setIdempotentResponse(
        idempotencyKey,
        result.status === 'failed' ? 'failed' : 'completed',
        payload
      );
    }

    return success(res, payload);
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
 * Get all screenplays for the current user.
 * Prefers userId from JWT when authenticated; falls back to query userId for backward compatibility.
 */
router.get(
  '/screenplays',
  asyncHandler(async (req: Request, res: Response) => {
    const userId =
      (req as AuthenticatedRequest).userId ?? (req.query['userId'] as string | undefined);

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
 * GET /api/v1/video/slideshows
 * Get all slideshows for the current user (from slideshows table only).
 */
router.get(
  '/slideshows',
  asyncHandler(async (req: Request, res: Response) => {
    const userId =
      (req as AuthenticatedRequest).userId ?? (req.query['userId'] as string | undefined);

    const slideshows = await videoService.getSlideshows(userId);

    return success(res, { slideshows });
  })
);

/**
 * GET /api/v1/video/project/:id/slideshows
 * Get slideshows for a specific project (from slideshows table only).
 */
router.get(
  '/project/:id/slideshows',
  asyncHandler(async (req: Request, res: Response) => {
    const idResult = uuidSchema.safeParse(req.params['id']);

    if (!idResult.success) {
      throw new ValidationError('Invalid project ID format');
    }

    const slideshows = await videoService.getProjectSlideshows(idResult.data);

    return success(res, { slideshows });
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
 * Generate a slideshow from document content.
 * Accepts either:
 * - JSON body: { content: "full document text", title?, maxSlides?, ... }
 * - multipart/form-data: field "document" (file .docx, .pdf, or .txt) + optional title, maxSlides, style, etc.
 * When a document file is uploaded, full text is extracted server-side for maximum relevance.
 */
router.post(
  '/generate-slideshow',
  asyncHandler(async (req: Request, res: Response) => {
    // Parse multipart form when client sends a file
    if (req.is('multipart/form-data')) {
      await new Promise<void>((resolve, reject) => {
        documentUpload(req, res, (err: unknown) => (err ? reject(err) : resolve()));
      });
    }

    let body = req.body as Record<string, unknown>;

    if (req.file) {
      const { text } = await extractTextFromDocument(req.file.buffer, req.file.mimetype);
      body = {
        ...body,
        content: text,
      };
    }

    // Coerce form field strings to schema types
    const normalized = {
      content: body.content,
      title: body.title,
      maxSlides:
        typeof body.maxSlides === 'string' ? parseInt(body.maxSlides, 10) || 8 : body.maxSlides,
      slideDuration:
        typeof body.slideDuration === 'string'
          ? parseInt(body.slideDuration, 10) || 5
          : body.slideDuration,
      style: body.style,
      aspectRatio: body.aspectRatio,
      contentAiModel: body.contentAiModel,
      userId: body.userId,
      projectId: body.projectId,
      idempotencyKey: body.idempotencyKey,
    };

    const validated = slideshowRequestSchema.safeParse(normalized);

    if (!validated.success) {
      throw validated.error;
    }

    const { projectId, idempotencyKey } = validated.data;
    const userId = (req as AuthenticatedRequest).userId ?? validated.data.userId;

    if (idempotencyKey) {
      const cached = getIdempotentResponse<
        { slides: unknown[]; totalDuration: number } | { error: string }
      >(idempotencyKey);
      if (cached) {
        if (cached.status === 'processing') {
          return res.status(409).json({
            success: false,
            error:
              'Duplicate request; previous request still in progress. Use the same idempotency key when retrying.',
          });
        }
        if (cached.status === 'failed') {
          const errBody = cached.response as { error?: string };
          return res.status(503).json({
            success: false,
            error: errBody?.error ?? 'Slideshow generation failed previously.',
          });
        }
        const payload = cached.response as { slides: unknown[]; totalDuration: number };
        return success(res, {
          slides: payload.slides,
          totalDuration: payload.totalDuration,
          slideCount: payload.slides.length,
        });
      }
      if (!setIdempotentProcessing(idempotencyKey)) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate idempotency key.',
        });
      }
    }

    const result = await slideshowService.generateSlideshow(validated.data);

    if (!result.success) {
      if (idempotencyKey) {
        setIdempotentResponse(idempotencyKey, 'failed', { error: result.error });
      }
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    if (userId) {
      await videoService.persistSlideshow({
        userId,
        projectId,
        title: validated.data.title,
        slides: result.slides,
        slideDuration: validated.data.slideDuration ?? 5,
      });
    }

    const payload = {
      slides: result.slides,
      totalDuration: result.totalDuration,
      slideCount: result.slides.length,
    };
    if (idempotencyKey) {
      setIdempotentResponse(idempotencyKey, 'completed', payload);
    }

    return success(res, payload);
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

/**
 * POST /api/v1/video/export-slideshow
 * Export slides to PowerPoint (.pptx) or PDF
 */
router.post(
  '/export-slideshow',
  asyncHandler(async (req: Request, res: Response) => {
    const validated = exportSlideshowRequestSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({
        success: false,
        error: validated.error.flatten().fieldErrors
          ? Object.entries(validated.error.flatten().fieldErrors)
              .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
              .join('; ')
          : 'Invalid request body',
      });
    }
    const { slides, title, format } = validated.data;
    const normalizedSlides = slides.map((s) => ({
      ...s,
      imageUrl: s.imageUrl && s.imageUrl.startsWith('http') ? s.imageUrl : undefined,
    }));
    const result = await slideshowExportService.exportSlideshow(normalizedSlides, {
      title: title || 'Presentation',
      format,
    });
    const filename = `slideshow-${Date.now()}.${result.fileExtension}`;
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    return res.send(result.buffer);
  })
);

export default router;
