/**
 * Fal Video Service
 *
 * Direct text-to-video and image-to-video generation using fal.ai models.
 * This service provides a simpler interface for quick video generation
 * without the full screenplay workflow.
 */

import fetch, { Headers, Request, Response } from 'node-fetch';
import {
  FAL_VIDEO_MODELS,
  FAL_IMAGE_TO_VIDEO_MODELS,
  FalVideoModel,
  FalImageToVideoModel,
  FalAspectRatio,
} from '@/config/constants';
import { ServiceUnavailableError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const g = globalThis as unknown as Record<string, unknown>;
if (!g.fetch) {
  g.fetch = fetch;
  g.Headers = Headers;
  g.Request = Request;
  g.Response = Response;
}

let fal: typeof import('@fal-ai/client').fal;

const serviceLogger = logger.child({ service: 'fal-video' });

/** Possible fal.ai video result shapes */
interface FalVideoOutput {
  video?: { url?: string };
  video_url?: string;
  output?: { url?: string };
}

let isConfigured = false;

/**
 * Initialize fal client with API key
 */
async function initializeFalClient(): Promise<void> {
  if (isConfigured && fal) {
    return;
  }

  const apiKey = process.env['FAL_AI_API_KEY'];
  if (!apiKey) {
    throw new ServiceUnavailableError('Fal AI', 'API key not configured');
  }

  // Log key format for debugging (only first/last few chars)
  const keyPreview =
    apiKey.length > 10
      ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
      : '***';
  serviceLogger.debug('Initializing Fal AI client', {
    keyFormat: apiKey.includes(':') ? 'key_id:key_secret' : 'single_key',
    keyPreview,
  });

  const falModule = await import('@fal-ai/client');
  fal = falModule.fal;

  fal.config({
    credentials: apiKey,
  });

  isConfigured = true;
  serviceLogger.debug('Fal AI client initialized for video generation');
}

/**
 * Check if Fal AI is configured
 */
export function isFalConfigured(): boolean {
  return !!process.env['FAL_AI_API_KEY'];
}

export interface FalVideoResult {
  success: boolean;
  videoUrl?: string;
  requestId?: string;
  error?: string;
}

/**
 * Build model-specific input parameters
 * Different fal.ai models accept different parameters
 */
function buildModelInput(
  model: FalVideoModel,
  prompt: string,
  options: { duration?: number; aspectRatio?: FalAspectRatio }
): Record<string, unknown> {
  const { aspectRatio } = options;

  switch (model) {
    // case 'minimax':
    //   // MiniMax only accepts prompt and prompt_optimizer
    //   return {
    //     prompt,
    //     prompt_optimizer: true,
    //   };

    case 'wan':
      // Wan accepts more parameters
      return {
        prompt,
        ...(aspectRatio && { aspect_ratio: aspectRatio }),
      };

    case 'luma':
      // Luma Dream Machine parameters
      return {
        prompt,
        ...(aspectRatio && { aspect_ratio: aspectRatio }),
      };

    default:
      return { prompt };
  }
}

/**
 * Generate video from text prompt using fal.ai
 */
export async function generateTextToVideo(
  prompt: string,
  options: {
    duration?: number;
    aspectRatio?: FalAspectRatio;
    model?: FalVideoModel;
  } = {}
): Promise<FalVideoResult> {
  const { duration = 5, aspectRatio = '16:9', model = 'luma' } = options;

  serviceLogger.info('Starting fal.ai text-to-video generation', {
    promptLength: prompt.length,
    duration,
    aspectRatio,
    model,
  });

  if (!isFalConfigured()) {
    return {
      success: false,
      error: 'Fal AI API not configured. Add FAL_AI_API_KEY to enable video generation.',
    };
  }

  try {
    await initializeFalClient();

    const modelId = FAL_VIDEO_MODELS[model] || FAL_VIDEO_MODELS.luma;
    const input = buildModelInput(model, prompt, { duration, aspectRatio });

    serviceLogger.debug(`Generating video with model: ${modelId}`, { input });

    const result = await fal.subscribe(modelId, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          serviceLogger.debug('Fal AI progress', {
            logs: update.logs?.map((log) => log.message),
          });
        }
      },
    });

    const data = result.data as FalVideoOutput;
    const videoUrl = data?.video?.url ?? data?.video_url ?? data?.output?.url;

    if (!videoUrl) {
      serviceLogger.error('No video URL in fal.ai response', { result });
      return {
        success: false,
        requestId: result.requestId,
        error: 'Video generation completed but no URL returned',
      };
    }

    serviceLogger.info('Video generated successfully', {
      videoUrl,
      requestId: result.requestId,
    });

    return {
      success: true,
      videoUrl,
      requestId: result.requestId,
    };
  } catch (error) {
    return handleFalError(error);
  }
}

/**
 * Generate video from image using fal.ai
 */
export async function generateImageToVideo(
  prompt: string,
  imageUrl: string,
  options: {
    model?: FalImageToVideoModel;
  } = {}
): Promise<FalVideoResult> {
  const { model = 'kling' } = options;

  serviceLogger.info('Starting fal.ai image-to-video generation', {
    promptLength: prompt.length,
    imageUrl: `${imageUrl.substring(0, 50)}...`,
    model,
  });

  if (!isFalConfigured()) {
    return {
      success: false,
      error: 'Fal AI API not configured. Add FAL_AI_API_KEY to enable video generation.',
    };
  }

  try {
    await initializeFalClient();

    const modelId = FAL_IMAGE_TO_VIDEO_MODELS[model] || FAL_IMAGE_TO_VIDEO_MODELS.kling;

    serviceLogger.debug(`Generating video with model: ${modelId}`);

    const result = await fal.subscribe(modelId, {
      input: {
        prompt,
        image_url: imageUrl,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          serviceLogger.debug('Fal AI progress', {
            logs: update.logs?.map((log) => log.message),
          });
        }
      },
    });

    const data = result.data as FalVideoOutput;
    const videoUrl = data?.video?.url ?? data?.video_url ?? data?.output?.url;

    if (!videoUrl) {
      serviceLogger.error('No video URL in fal.ai response', { result });
      return {
        success: false,
        requestId: result.requestId,
        error: 'Video generation completed but no URL returned',
      };
    }

    serviceLogger.info('Image-to-video generated successfully', {
      videoUrl,
      requestId: result.requestId,
    });

    return {
      success: true,
      videoUrl,
      requestId: result.requestId,
    };
  } catch (error) {
    return handleFalError(error);
  }
}

/**
 * Handle Fal AI errors
 */
interface ErrorWithDetails extends Error {
  body?: unknown;
  response?: unknown;
}

function handleFalError(error: unknown): FalVideoResult {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const err = error as ErrorWithDetails;
  const errorDetails = error instanceof Error ? (err.body ?? err.response) : undefined;

  serviceLogger.error('Fal AI error', {
    error: errorMessage,
    details: errorDetails,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (
    errorMessage.includes('401') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('Invalid API key')
  ) {
    return {
      success: false,
      error: 'Invalid Fal AI API key. Please check your FAL_AI_API_KEY.',
    };
  }

  if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
    return {
      success: false,
      error:
        'Fal AI access forbidden. This usually means: (1) Your API key is invalid, (2) Your account has no purchased credits (free credits only work in the Playground, not via API), or (3) The key lacks permissions for this model. Add credits at https://fal.ai/dashboard/billing',
    };
  }

  if (errorMessage.includes('insufficient') || errorMessage.includes('credits')) {
    return {
      success: false,
      error: 'Insufficient Fal AI credits. Please add credits at https://fal.ai',
    };
  }

  if (errorMessage.includes('rate limit')) {
    return {
      success: false,
      error: 'Rate limit exceeded. Please try again later.',
    };
  }

  return {
    success: false,
    error: `Fal AI video generation failed: ${errorMessage}`,
  };
}
