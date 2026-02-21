/**
 * Fal AI Service
 *
 * Handles video generation using Fal AI's Ovi model.
 * Ovi is a unified paradigm for audio-video generation (text-to-video).
 */

import fetch from 'node-fetch';
import { FAL_CONFIG } from '@/config/constants';
import { ExternalServiceError, ServiceUnavailableError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { Screenplay, VideoFormat, ScreenplayScene } from '@/types/api';
import { VideoGenerationResult } from '@/types/models';

// Polyfill fetch for Node.js environments that don't have it natively
if (!globalThis.fetch) {
  (globalThis as any).fetch = fetch;
  (globalThis as any).Headers = (fetch as any).Headers;
  (globalThis as any).Request = (fetch as any).Request;
  (globalThis as any).Response = (fetch as any).Response;
}

// Dynamic import for fal client (after fetch polyfill)
let fal: typeof import('@fal-ai/client').fal;

const serviceLogger = logger.child({ service: 'fal' });

// Track if fal client is configured
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

  // Dynamic import after fetch is available
  const falModule = await import('@fal-ai/client');
  fal = falModule.fal;

  fal.config({
    credentials: apiKey,
  });

  isConfigured = true;
  serviceLogger.debug('Fal AI client initialized');
}

/**
 * Check if Fal AI is configured
 */
export function isFalConfigured(): boolean {
  return !!process.env['FAL_AI_API_KEY'];
}

/**
 * Ovi model resolution options
 */
type OviResolution =
  | '512x992'
  | '992x512'
  | '960x512'
  | '512x960'
  | '720x720'
  | '448x1120'
  | '1120x448';

/**
 * Get resolution based on video format
 */
function getResolution(format?: VideoFormat): OviResolution {
  switch (format) {
    case 'reel':
      return '512x992'; // Vertical for reels/shorts
    case 'short_video':
      return '992x512'; // Horizontal
    case 'vfx_movie':
      return '992x512'; // Horizontal cinematic
    case 'presentation':
      return '992x512'; // Horizontal
    default:
      return '992x512'; // Default horizontal
  }
}

/**
 * Build Ovi prompt from scene
 * Ovi uses special tags for speech and audio:
 * - <S>...<E> for speech/dialogue
 * - <AUDCAP>...<ENDAUDCAP> for audio description
 */
function buildOviPrompt(scene: ScreenplayScene, voiceoverStyle?: string): string {
  // Start with visual description
  let prompt = scene.visualDescription;

  // Add speech/narration if available
  if (scene.narration) {
    prompt += ` They say, <S>${scene.narration}<E>.`;
  }

  // Add audio caption for ambient sounds
  const audioStyle = voiceoverStyle || 'Professional narration';
  const audioCap = scene.narration
    ? `${audioStyle} voice with ambient background sounds`
    : 'Ambient background sounds matching the scene';

  prompt += `<AUDCAP>${audioCap}<ENDAUDCAP>`;

  // Ensure prompt is not too long (Ovi has limits)
  if (prompt.length > 2000) {
    prompt = `${prompt.substring(0, 1997)}...`;
  }

  return prompt;
}

/**
 * Generate video from screenplay using Fal AI Ovi model
 */
export async function generateVideoFromScreenplay(
  screenplay: Screenplay,
  onProgress?: (progress: number, status: string) => void
): Promise<VideoGenerationResult> {
  serviceLogger.info('Starting Fal AI video generation', {
    title: screenplay.title,
    sceneCount: screenplay.scenes.length,
  });

  if (!isFalConfigured()) {
    serviceLogger.warn('Fal AI not configured, returning placeholder');
    return {
      videoId: `fal_placeholder_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error: 'Fal AI API not configured. Add FAL_AI_API_KEY to enable video generation.',
    };
  }

  await initializeFalClient();

  const scenesToGenerate = screenplay.scenes.slice(0, FAL_CONFIG.MAX_SCENES_PER_GENERATION);
  const resolution = getResolution(screenplay.format);

  const videoUrls: string[] = [];
  const videoIds: string[] = [];

  for (let i = 0; i < scenesToGenerate.length; i++) {
    const scene = scenesToGenerate[i];
    const prompt = buildOviPrompt(scene, screenplay.voiceoverStyle);

    if (onProgress) {
      const progressPercent = Math.round((i / scenesToGenerate.length) * 100);
      onProgress(progressPercent, `Generating scene ${i + 1} of ${scenesToGenerate.length}`);
    }

    serviceLogger.debug(`Generating scene ${i + 1}`, {
      promptLength: prompt.length,
      resolution,
    });

    try {
      const result = await generateSingleClip(prompt, resolution);

      if (result.videoUrl) {
        videoUrls.push(result.videoUrl);
        videoIds.push(result.videoId);
        serviceLogger.info(`Scene ${i + 1} completed`, {
          videoId: result.videoId,
        });
      } else {
        serviceLogger.warn(`Scene ${i + 1} failed`, { error: result.error });
      }
    } catch (error) {
      serviceLogger.error(`Error generating scene ${i + 1}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (onProgress) {
    onProgress(100, 'All scenes generated');
  }

  serviceLogger.info('Fal AI video generation completed', {
    totalClips: videoUrls.length,
    success: videoUrls.length > 0,
  });

  return {
    videoId: videoIds.join(','),
    status: videoUrls.length > 0 ? 'completed' : 'failed',
    progress: 100,
    videoUrl: videoUrls[0],
    videoUrls,
    error: videoUrls.length === 0 ? 'Failed to generate any video clips' : undefined,
  };
}

/**
 * Generate a single video clip using Ovi model
 */
async function generateSingleClip(
  prompt: string,
  resolution: OviResolution
): Promise<VideoGenerationResult> {
  try {
    await initializeFalClient();

    serviceLogger.debug('Submitting to Fal AI Ovi', { resolution });

    const result = await fal.subscribe(FAL_CONFIG.MODEL, {
      input: {
        prompt,
        resolution,
        negative_prompt: FAL_CONFIG.NEGATIVE_PROMPT,
        audio_negative_prompt: FAL_CONFIG.AUDIO_NEGATIVE_PROMPT,
        num_inference_steps: FAL_CONFIG.NUM_INFERENCE_STEPS,
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

    const videoUrl = (result.data as any)?.video?.url;
    const requestId = result.requestId || `fal_${Date.now()}`;

    if (!videoUrl) {
      return {
        videoId: requestId,
        status: 'failed',
        progress: 0,
        error: 'No video URL in response',
      };
    }

    return {
      videoId: requestId,
      status: 'completed',
      progress: 100,
      videoUrl,
    };
  } catch (error) {
    return handleFalError(error);
  }
}

/**
 * Check video generation status (for queue-based requests)
 */
export async function checkVideoStatus(requestId: string): Promise<VideoGenerationResult> {
  if (!isFalConfigured() || requestId.startsWith('fal_placeholder_')) {
    return {
      videoId: requestId,
      status: 'completed',
      progress: 100,
      error: 'No video generation API configured',
    };
  }

  try {
    await initializeFalClient();

    const status = await fal.queue.status(FAL_CONFIG.MODEL, {
      requestId,
      logs: true,
    });

    const statusMap: Record<string, VideoGenerationResult['status']> = {
      IN_QUEUE: 'queued',
      IN_PROGRESS: 'in_progress',
      COMPLETED: 'completed',
      FAILED: 'failed',
    };

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(FAL_CONFIG.MODEL, {
        requestId,
      });
      const videoUrl = (result.data as any)?.video?.url;

      return {
        videoId: requestId,
        status: 'completed',
        progress: 100,
        videoUrl,
      };
    }

    return {
      videoId: requestId,
      status: statusMap[status.status] || 'in_progress',
      progress: status.status === 'IN_PROGRESS' ? 50 : 25,
    };
  } catch (error) {
    serviceLogger.error('Error checking Fal AI status', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new ExternalServiceError('Fal AI', 'Failed to check video status');
  }
}

/**
 * Handle Fal AI errors
 */
function handleFalError(error: unknown): VideoGenerationResult {
  const errorMessage = error instanceof Error ? error.message : String(error);

  serviceLogger.error('Fal AI error', { error: errorMessage });

  if (
    errorMessage.includes('401') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('Invalid API key')
  ) {
    return {
      videoId: `error_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error: 'Invalid Fal AI API key. Please check your FAL_AI_API_KEY.',
    };
  }

  if (errorMessage.includes('insufficient') || errorMessage.includes('credits')) {
    return {
      videoId: `error_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error: 'Insufficient Fal AI credits. Please add credits at https://fal.ai',
    };
  }

  if (errorMessage.includes('rate limit')) {
    return {
      videoId: `error_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error: 'Rate limit exceeded. Please try again later.',
    };
  }

  return {
    videoId: `error_${Date.now()}`,
    status: 'failed',
    progress: 0,
    error: `Fal AI video generation failed: ${errorMessage}`,
  };
}
