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
  USER_CREDITS: 'user_credits',
  CREDIT_TRANSACTIONS: 'credit_transactions',
  GENERATION_HISTORY: 'generation_history',
} as const;

/**
 * Credit costs for different operations
 */
export const CREDIT_COSTS = {
  SCREENPLAY_GENERATION: 0, // Free
  VIDEO_GENERATION_REEL: 10,
  VIDEO_GENERATION_SHORT: 15,
  VIDEO_GENERATION_VFX: 25,
  VIDEO_GENERATION_PRESENTATION: 20,
  SCREENPLAY_ENHANCEMENT: 0, // Free
} as const;

/**
 * Default credits for new users by plan
 */
export const DEFAULT_CREDITS = {
  free: 50,
  starter: 200,
  pro: 500,
  enterprise: 2000,
} as const;

/**
 * Subscription plans configuration
 */
export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic video generation',
    price: 0,
    priceMonthly: 0,
    priceYearly: 0,
    credits: 50,
    features: [
      '50 credits per month',
      'Basic video formats (Reel)',
      'Standard quality',
      'Community support',
    ],
    limitations: ['Watermark on videos', 'Max 30s duration'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for content creators getting started',
    price: 9.99,
    priceMonthly: 9.99,
    priceYearly: 99.99,
    credits: 200,
    features: [
      '200 credits per month',
      'All video formats',
      'HD quality',
      'No watermark',
      'Email support',
      'Max 60s duration',
    ],
    limitations: [],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For professional content creators',
    price: 29.99,
    priceMonthly: 29.99,
    priceYearly: 299.99,
    credits: 500,
    features: [
      '500 credits per month',
      'All video formats',
      '4K quality',
      'No watermark',
      'Priority support',
      'Max 5min duration',
      'Custom branding',
      'API access',
    ],
    limitations: [],
    popular: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For teams and businesses',
    price: 99.99,
    priceMonthly: 99.99,
    priceYearly: 999.99,
    credits: 2000,
    features: [
      '2000 credits per month',
      'Unlimited video formats',
      '4K+ quality',
      'No watermark',
      'Dedicated support',
      'Unlimited duration',
      'Custom branding',
      'Full API access',
      'Team collaboration',
      'Analytics dashboard',
    ],
    limitations: [],
  },
} as const;

/**
 * Credit packages for one-time purchase
 */
export const CREDIT_PACKAGES = {
  small: {
    id: 'credits_small',
    name: 'Small Pack',
    credits: 50,
    price: 4.99,
    savings: 0,
  },
  medium: {
    id: 'credits_medium',
    name: 'Medium Pack',
    credits: 150,
    price: 12.99,
    savings: 13,
  },
  large: {
    id: 'credits_large',
    name: 'Large Pack',
    credits: 400,
    price: 29.99,
    savings: 25,
  },
  mega: {
    id: 'credits_mega',
    name: 'Mega Pack',
    credits: 1000,
    price: 59.99,
    savings: 40,
  },
} as const;

/**
 * Admin user IDs (can be moved to env or database)
 */
export const ADMIN_USERS = {
  // Add admin user IDs here, or load from env
  emails: process.env['ADMIN_EMAILS']?.split(',') || [],
  userIds: process.env['ADMIN_USER_IDS']?.split(',') || [],
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
 * Fal AI configuration (Ovi text-to-video model)
 */
export const FAL_CONFIG = {
  MODEL: 'fal-ai/ovi',
  MAX_SCENES_PER_GENERATION: 3,
  NUM_INFERENCE_STEPS: 30,
  NEGATIVE_PROMPT: 'jitter, bad hands, blur, distortion',
  AUDIO_NEGATIVE_PROMPT: 'robotic, muffled, echo, distorted',
  DEFAULT_RESOLUTION: '992x512' as const,
} as const;

/**
 * Request timeouts (in milliseconds)
 */
export const TIMEOUTS = {
  DEFAULT: 30000,
  VIDEO_GENERATION: 300000, // 5 minutes
  OPENAI_REQUEST: 60000,
} as const;
