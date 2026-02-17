/**
 * Application Constants
 *
 * Centralized location for all application constants.
 * Organized by domain for easy navigation.
 */

/**
 * Database table names
 */
export const TABLES = {
  PROJECTS: 'projects',
  CHAT_HISTORY: 'chat_history',
  PEXELS_VIDEOS: 'pexels_videos',
  PROJECT_FILES: 'project_files',
} as const;

/**
 * API versioning
 */
export const API_VERSION = {
  V1: '/api/v1',
  CURRENT: '/api/v1',
} as const;

/**
 * Video format configurations
 */
export const VIDEO_FORMATS = {
  REEL: 'reel',
  SHORT_VIDEO: 'short_video',
  VFX_MOVIE: 'vfx_movie',
  PRESENTATION: 'presentation',
} as const;

export const FORMAT_CONFIG = {
  [VIDEO_FORMATS.REEL]: {
    description: 'Instagram/TikTok style vertical short-form video',
    pacing: 'Fast-paced with quick cuts, engaging hooks in first 3 seconds',
    style: 'Trendy, attention-grabbing, with text overlays and dynamic transitions',
    aspectRatio: '720:1280' as const,
    defaultDuration: 30,
    maxDuration: 60,
  },
  [VIDEO_FORMATS.SHORT_VIDEO]: {
    description: 'YouTube Shorts or quick explainer video',
    pacing: 'Medium pacing with clear structure: hook, content, call-to-action',
    style: 'Informative yet engaging, with clear visual storytelling',
    aspectRatio: '1280:720' as const,
    defaultDuration: 60,
    maxDuration: 180,
  },
  [VIDEO_FORMATS.VFX_MOVIE]: {
    description: 'Cinematic content with visual effects emphasis',
    pacing: 'Slower, dramatic pacing with emphasis on visual spectacle',
    style: 'Cinematic, epic, with dramatic narration and atmospheric music',
    aspectRatio: '1280:720' as const,
    defaultDuration: 120,
    maxDuration: 300,
  },
  [VIDEO_FORMATS.PRESENTATION]: {
    description: 'Professional slide-style presentation video',
    pacing: 'Steady, educational pacing allowing information absorption',
    style: 'Professional, clear, with bullet points and data visualization suggestions',
    aspectRatio: '1280:720' as const,
    defaultDuration: 180,
    maxDuration: 600,
  },
} as const;

/**
 * Project statuses
 */
export const PROJECT_STATUS = {
  DRAFT: 'draft',
  SCREENPLAY_GENERATED: 'screenplay_generated',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Pagination defaults
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/**
 * OpenAI configuration
 */
export const OPENAI_CONFIG = {
  MODEL: 'gpt-4.1',
  MAX_TOKENS: 2000,
  TEMPERATURE: 0.7,
} as const;

/**
 * Runway ML configuration
 */
export const RUNWAY_CONFIG = {
  BASE_URL: 'https://api.dev.runwayml.com',
  MODEL: 'gen4_turbo',
  CLIP_DURATION: 5,
  MAX_SCENES_PER_GENERATION: 3,
  DEFAULT_PROMPT_IMAGE: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1280',
} as const;

/**
 * Request timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  DEFAULT: 30000,
  VIDEO_GENERATION: 300000, // 5 minutes
  OPENAI_REQUEST: 60000,
} as const;
