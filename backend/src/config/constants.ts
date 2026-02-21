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
  CHAT_MESSAGES: 'chat_messages',
  SCREENPLAY_VERSIONS: 'screenplay_versions',
  PEXELS_VIDEOS: 'pexels_videos',
  PROJECT_FILES: 'project_files',
  USER_CREDITS: 'user_credits',
  CREDIT_TRANSACTIONS: 'credit_transactions',
  GENERATION_HISTORY: 'generation_history',
  USER_PREFERENCES: 'user_preferences',
  INTEREST_SUBMISSIONS: 'interest_submissions',
} as const;

/**
 * Credit costs for different operations
 * MVP: Each video costs 10 credits, screenplays are free
 */
export const CREDIT_COSTS = {
  SCREENPLAY_GENERATION: 0, // Free - always
  VIDEO_GENERATION_REEL: 10, // ~$0.20 fal AI cost
  VIDEO_GENERATION_SHORT: 10, // Same for MVP simplicity
  VIDEO_GENERATION_VFX: 10, // Same for MVP simplicity
  VIDEO_GENERATION_PRESENTATION: 10, // Same for MVP simplicity
  SCREENPLAY_ENHANCEMENT: 0, // Free - always
} as const;

/**
 * MVP Beta Configuration
 * For initial 20 beta users with limited credits
 */
export const MVP_CONFIG = {
  MAX_BETA_USERS: 20,
  BETA_USER_CREDITS: 40, // 4 videos worth (10 credits each)
  BETA_PERIOD_DAYS: 14, // 2 weeks
  CREDITS_PER_VIDEO: 10,
  MAX_VIDEOS_PER_PERIOD: 4,
  IS_BETA_MODE: true, // Set to false when launching payments
} as const;

/**
 * Default credits for new users by plan
 */
export const DEFAULT_CREDITS = {
  free: 40, // MVP: 4 videos worth
  beta: 40, // Beta testers
  starter: 100, // 10 videos
  pro: 300, // 30 videos
  enterprise: 1000, // 100 videos
} as const;

/**
 * Subscription plans configuration
 * Pricing modeled after fal.ai (~$0.20/video) with margin
 */
export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free Trial',
    description: 'Try ContentAI with limited credits',
    price: 0,
    priceMonthly: 0,
    priceYearly: 0,
    credits: 40,
    videosIncluded: 4,
    features: [
      '4 AI videos included',
      'Unlimited screenplay generation',
      'All video formats',
      'Standard quality',
      'Community support',
    ],
    limitations: ['Limited to 4 videos total'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for content creators getting started',
    price: 9,
    priceMonthly: 9,
    priceYearly: 90,
    credits: 100,
    videosIncluded: 10,
    features: [
      '10 AI videos per month',
      'Unlimited screenplay generation',
      'All video formats',
      'HD quality',
      'Email support',
    ],
    limitations: [],
    stripePriceId: '', // Add Stripe price ID when ready
    squareSubscriptionId: '', // Add Square ID when ready
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For professional content creators',
    price: 29,
    priceMonthly: 29,
    priceYearly: 290,
    credits: 300,
    videosIncluded: 30,
    features: [
      '30 AI videos per month',
      'Unlimited screenplay generation',
      'All video formats',
      '4K quality',
      'Priority support',
      'Custom branding',
    ],
    limitations: [],
    popular: true,
    stripePriceId: '',
    squareSubscriptionId: '',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For teams and businesses',
    price: 99,
    priceMonthly: 99,
    priceYearly: 990,
    credits: 1000,
    videosIncluded: 100,
    features: [
      '100 AI videos per month',
      'Unlimited screenplay generation',
      'All video formats',
      '4K+ quality',
      'Dedicated support',
      'Custom branding',
      'API access',
      'Team collaboration',
    ],
    limitations: [],
    stripePriceId: '',
    squareSubscriptionId: '',
  },
} as const;

/**
 * Credit packages for one-time purchase
 * Each credit = 1 video (simplified for MVP)
 * Pricing: ~$1/video base, discounts for bulk
 */
export const CREDIT_PACKAGES = {
  small: {
    id: 'credits_5',
    name: '5 Videos',
    credits: 50, // 5 videos at 10 credits each
    videos: 5,
    price: 5,
    pricePerVideo: 1.0,
    savings: 0,
    stripePriceId: '',
    squareItemId: '',
  },
  medium: {
    id: 'credits_15',
    name: '15 Videos',
    credits: 150,
    videos: 15,
    price: 12,
    pricePerVideo: 0.8,
    savings: 20, // 20% off
    stripePriceId: '',
    squareItemId: '',
  },
  large: {
    id: 'credits_50',
    name: '50 Videos',
    credits: 500,
    videos: 50,
    price: 35,
    pricePerVideo: 0.7,
    savings: 30, // 30% off
    stripePriceId: '',
    squareItemId: '',
    popular: true,
  },
  mega: {
    id: 'credits_100',
    name: '100 Videos',
    credits: 1000,
    videos: 100,
    price: 60,
    pricePerVideo: 0.6,
    savings: 40, // 40% off
    stripePriceId: '',
    squareItemId: '',
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
