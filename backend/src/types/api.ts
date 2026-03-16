/**
 * API Types
 *
 * Request and response types for the API.
 */

import { z } from 'zod';
import { VIDEO_FORMATS, PROJECT_STATUS, FAL_ASPECT_RATIOS } from '@/config/constants';

// =============================================================================
// Common Schemas
// =============================================================================

/**
 * UUID validation
 */
export const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Pagination query parameters
 */
export const paginationSchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20)),
});

// =============================================================================
// Video Schemas
// =============================================================================

/**
 * Video format enum
 */
export const videoFormatSchema = z.enum([
  VIDEO_FORMATS.REEL,
  VIDEO_FORMATS.SHORT_VIDEO,
  VIDEO_FORMATS.VFX_MOVIE,
  VIDEO_FORMATS.PRESENTATION,
]);

/**
 * Project status enum
 */
export const projectStatusSchema = z.enum([
  PROJECT_STATUS.DRAFT,
  PROJECT_STATUS.SCREENPLAY_GENERATED,
  PROJECT_STATUS.PROCESSING,
  PROJECT_STATUS.COMPLETED,
  PROJECT_STATUS.FAILED,
]);

/**
 * Screenplay scene schema
 */
export const screenplaySceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  duration: z.number().positive(),
  visualDescription: z.string().min(1),
  narration: z.string(),
  textOverlay: z.string().optional(),
  transition: z.string().optional(),
  imageUrl: z.string().url().optional(), // slide/slideshow image URL (persisted for History → Slides)
});

/**
 * Screenplay schema
 */
export const screenplaySchema = z.object({
  title: z.string().min(1),
  format: videoFormatSchema,
  totalDuration: z.number().positive(),
  scenes: z.array(screenplaySceneSchema).min(1),
  voiceoverStyle: z.string().optional(),
  musicSuggestion: z.string().optional(),
});

/**
 * Video generation request schema
 */
export const videoGenerationRequestSchema = z.object({
  projectId: uuidSchema.optional(),
  projectName: z.string().min(1, 'Project name is required').max(255),
  format: videoFormatSchema,
  targetDuration: z.number().int().positive().max(600).default(30),
  topic: z.string().min(1, 'Topic is required').max(1000),
  aiModel: z.string().default('gpt-4.1'),
  enableVoiceover: z.boolean().default(true),
  enableCaptions: z.boolean().default(false),
  backgroundVideo: z
    .object({
      id: z.string(),
      url: z.string().url(),
      thumbnailUrl: z.string().url(),
    })
    .optional(),
  userId: z.string().min(1, 'User ID is required'),
  documentContent: z.string().optional(),
});

/**
 * Enhance screenplay request schema
 */
export const enhanceScreenplayRequestSchema = z.object({
  projectId: uuidSchema.optional(),
  screenplay: screenplaySchema,
  feedback: z.string().min(1, 'Feedback is required').max(2000),
  aiModel: z.string().optional(),
});

/**
 * Generate video from screenplay request schema
 */
export const generateVideoRequestSchema = z.object({
  projectId: uuidSchema.optional(),
  screenplay: screenplaySchema,
  userId: z.string().optional(),
  idempotencyKey: z.string().max(256).optional(),
});

// =============================================================================
// Project Schemas
// =============================================================================

/**
 * Create project request schema
 */
export const createProjectRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  content_type: z.string().min(1, 'Content type is required'),
});

/**
 * Update project request schema
 */
export const updateProjectRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  status: projectStatusSchema.optional(),
});

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type VideoFormat = z.infer<typeof videoFormatSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ScreenplayScene = z.infer<typeof screenplaySceneSchema>;
export type Screenplay = z.infer<typeof screenplaySchema>;
export type VideoGenerationRequest = z.infer<typeof videoGenerationRequestSchema>;
export type EnhanceScreenplayRequest = z.infer<typeof enhanceScreenplayRequestSchema>;
export type GenerateVideoRequest = z.infer<typeof generateVideoRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type PaginationParams = z.infer<typeof paginationSchema>;

// =============================================================================
// Fal AI Direct Video Generation Schemas
// =============================================================================

/**
 * Fal video model enum
 * Must match keys in FAL_VIDEO_MODELS constant
 */
export const falVideoModelSchema = z.enum(['wan', 'luma']);

/**
 * Fal image-to-video model enum
 * Must match keys in FAL_IMAGE_TO_VIDEO_MODELS constant
 */
export const falImageToVideoModelSchema = z.enum(['kling', 'luma']);

/**
 * Fal aspect ratio enum
 */
export const falAspectRatioSchema = z.enum([
  FAL_ASPECT_RATIOS.LANDSCAPE,
  FAL_ASPECT_RATIOS.PORTRAIT,
  FAL_ASPECT_RATIOS.SQUARE,
]);

/**
 * Fal text-to-video request schema
 */
export const falVideoRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(2000),
  duration: z.number().int().positive().max(10).default(5),
  aspectRatio: falAspectRatioSchema.default('16:9'),
  model: falVideoModelSchema.default('luma'),
  userId: z.string().optional(),
});

/**
 * Fal image-to-video request schema
 */
export const falImageToVideoRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(2000),
  imageUrl: z.string().url('Valid image URL is required'),
  model: falImageToVideoModelSchema.default('kling'),
  userId: z.string().optional(),
});

export type FalVideoRequest = z.infer<typeof falVideoRequestSchema>;
export type FalImageToVideoRequest = z.infer<typeof falImageToVideoRequestSchema>;
export type FalAspectRatio = z.infer<typeof falAspectRatioSchema>;

// =============================================================================
// Slideshow Generation Schemas
// =============================================================================

/**
 * Slideshow style enum
 */
export const slideshowStyleSchema = z.enum(['modern', 'minimal', 'corporate', 'creative']);

/** Content AI for slideshow: openai (GPT) or kimi (Moonshot) */
export const slideshowContentAiSchema = z.enum(['openai', 'kimi']);

/**
 * Slideshow generation request schema
 */
export const slideshowRequestSchema = z.object({
  content: z
    .string()
    .min(10, 'Content must be at least 10 characters')
    .describe(
      'For document-relevant slides, send the full extracted document text; short content (e.g. topic only) yields generic slides.'
    ),
  title: z.string().optional(),
  maxSlides: z.number().int().min(3).max(15).default(8),
  slideDuration: z.number().int().min(3).max(15).default(5),
  style: slideshowStyleSchema.default('modern'),
  aspectRatio: z.enum(['16:9', '4:3']).default('16:9'),
  contentAiModel: slideshowContentAiSchema.optional(),
  userId: z.string().optional(),
  projectId: uuidSchema.optional(),
  idempotencyKey: z.string().max(256).optional(),
});

/**
 * Preview slideshow request (simpler, fewer options)
 * Accepts short topics (e.g., "AWS Cloud") - backend will expand into full content
 */
export const previewSlideshowRequestSchema = z.object({
  content: z.string().min(3, 'Content must be at least 3 characters'),
  style: slideshowStyleSchema.optional(),
  userId: z.string().optional(),
});

/** Slide shape for export (PPT/PDF) */
export const exportSlideSchema = z.object({
  slideNumber: z.number(),
  title: z.string(),
  bulletPoints: z.array(z.string()),
  narration: z.string(),
  visualDescription: z.string(),
  imageUrl: z.union([z.string().url(), z.literal('')]).optional(),
});

export const exportSlideshowRequestSchema = z.object({
  slides: z.array(exportSlideSchema).min(1),
  title: z.string().max(255).optional(),
  format: z.enum(['pptx', 'pdf']),
});

export type SlideshowRequest = z.infer<typeof slideshowRequestSchema>;
export type PreviewSlideshowRequest = z.infer<typeof previewSlideshowRequestSchema>;
export type SlideshowStyle = z.infer<typeof slideshowStyleSchema>;
export type ExportSlideshowRequest = z.infer<typeof exportSlideshowRequestSchema>;
