/**
 * Runway ML Service
 *
 * Handles video generation using Runway ML API.
 */

import RunwayML from '@runwayml/sdk';
import { RUNWAY_CONFIG } from '@/config/constants';
import { getEnv } from '@/config/env';
import { ExternalServiceError, ServiceUnavailableError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { Screenplay, VideoFormat, ScreenplayScene } from '@/types/api';
import { VideoGenerationResult } from '@/types/models';

// Lazy-initialized client
let client: RunwayML | null = null;

/**
 * Check if Runway is configured
 */
export function isRunwayConfigured(): boolean {
  try {
    const env = getEnv();
    return !!env.RUNWAY_API_KEY;
  } catch {
    return false;
  }
}

/**
 * Get Runway client (lazy initialization)
 */
function getClient(): RunwayML {
  if (!client) {
    const env = getEnv();
    if (!env.RUNWAY_API_KEY) {
      throw new ServiceUnavailableError('Runway ML', 'API key not configured');
    }
    client = new RunwayML({
      apiKey: env.RUNWAY_API_KEY,
      baseURL: RUNWAY_CONFIG.BASE_URL,
    });
    logger.debug('Runway ML client initialized');
  }
  return client;
}

/**
 * Generate video from screenplay
 *
 * Creates multiple video clips from the first N scenes.
 */
export async function generateVideoFromScreenplay(
  screenplay: Screenplay,
  onProgress?: (progress: number, status: string) => void
): Promise<VideoGenerationResult> {
  const serviceLogger = logger.child({ service: 'runway' });

  serviceLogger.info('Starting video generation', {
    title: screenplay.title,
    sceneCount: screenplay.scenes.length,
  });

  if (!isRunwayConfigured()) {
    serviceLogger.warn('Runway not configured, returning placeholder');
    return {
      videoId: `screenplay_${Date.now()}`,
      status: 'completed',
      progress: 100,
      error:
        'Video generation API not configured. Add RUNWAY_API_KEY to enable automatic video generation.',
    };
  }

  const scenesToGenerate = screenplay.scenes.slice(0, RUNWAY_CONFIG.MAX_SCENES_PER_GENERATION);
  const style = screenplay.voiceoverStyle || 'Professional and engaging';

  const videoUrls: string[] = [];
  const videoIds: string[] = [];

  for (let i = 0; i < scenesToGenerate.length; i++) {
    const scene = scenesToGenerate[i];
    const prompt = buildScenePrompt(scene, screenplay.title, style, i + 1);

    if (onProgress) {
      const progressPercent = Math.round((i / scenesToGenerate.length) * 100);
      onProgress(progressPercent, `Generating scene ${i + 1} of ${scenesToGenerate.length}`);
    }

    serviceLogger.debug(`Generating scene ${i + 1}`, { promptLength: prompt.length });

    try {
      const result = await generateSingleClip(prompt, screenplay.format);

      if (result.videoUrl) {
        videoUrls.push(result.videoUrl);
        videoIds.push(result.videoId);
        serviceLogger.info(`Scene ${i + 1} completed`, { videoId: result.videoId });
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

  serviceLogger.info('Video generation completed', {
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
 * Generate a single video clip
 */
async function generateSingleClip(
  prompt: string,
  format?: VideoFormat
): Promise<VideoGenerationResult> {
  const serviceLogger = logger.child({ service: 'runway' });

  try {
    const runwayClient = getClient();

    // Determine aspect ratio based on format
    const ratio = getAspectRatio(format);

    serviceLogger.debug('Creating Runway task', { ratio });

    const task = await runwayClient.imageToVideo
      .create({
        model: RUNWAY_CONFIG.MODEL,
        promptImage: RUNWAY_CONFIG.DEFAULT_PROMPT_IMAGE,
        promptText: prompt,
        ratio,
        duration: RUNWAY_CONFIG.CLIP_DURATION,
      })
      .waitForTaskOutput();

    const videoUrl = (task as any).output?.[0];

    return {
      videoId: task.id,
      status: 'completed',
      progress: 100,
      videoUrl,
    };
  } catch (error) {
    return handleRunwayError(error);
  }
}

/**
 * Check video generation status
 */
export async function checkVideoStatus(videoId: string): Promise<VideoGenerationResult> {
  const serviceLogger = logger.child({ service: 'runway' });

  if (!isRunwayConfigured() || videoId.startsWith('screenplay_')) {
    return {
      videoId,
      status: 'completed',
      progress: 100,
      error: 'No video generation API configured',
    };
  }

  try {
    const runwayClient = getClient();
    const task = await runwayClient.tasks.retrieve(videoId);

    const statusMap: Record<string, VideoGenerationResult['status']> = {
      PENDING: 'queued',
      RUNNING: 'in_progress',
      SUCCEEDED: 'completed',
      FAILED: 'failed',
    };

    const taskAny = task as any;
    const taskStatus = taskAny.status || 'PENDING';
    const taskOutput = taskAny.output;

    return {
      videoId: task.id,
      status: statusMap[taskStatus] || 'in_progress',
      progress: taskStatus === 'SUCCEEDED' ? 100 : 50,
      videoUrl: taskOutput?.[0],
    };
  } catch (error) {
    serviceLogger.error('Error checking video status', {
      videoId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new ExternalServiceError('Runway ML', 'Failed to check video status');
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function buildScenePrompt(
  scene: ScreenplayScene,
  title: string,
  style: string,
  sceneNumber: number
): string {
  // Clean up visual description to remove any text-related instructions
  const cleanVisual = scene.visualDescription
    .replace(/text[:\s]*["']?[^"'.,]+["']?/gi, '')
    .replace(/title[:\s]*["']?[^"'.,]+["']?/gi, '')
    .replace(/words?[:\s]*["']?[^"'.,]+["']?/gi, '')
    .replace(/caption[:\s]*["']?[^"'.,]+["']?/gi, '')
    .replace(/["'][^"']+["']/g, '')
    .trim();

  let prompt = `${cleanVisual}. Cinematic ${style} style. NO TEXT OR WORDS IN VIDEO. Pure visual imagery only. High quality, smooth camera movements, professional cinematography.`;

  // Runway has a 1000 character limit
  if (prompt.length > 950) {
    prompt = `${prompt.substring(0, 947)}...`;
  }

  logger.debug(`Scene ${sceneNumber} prompt built`, { length: prompt.length });
  return prompt;
}

function getAspectRatio(format?: VideoFormat): '1280:720' | '720:1280' | '960:960' {
  if (format === 'reel') {
    return '720:1280'; // Vertical
  }
  return '1280:720'; // Landscape (default)
}

function handleRunwayError(error: unknown): VideoGenerationResult {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const serviceLogger = logger.child({ service: 'runway' });

  serviceLogger.error('Runway API error', { error: errorMessage });

  if (errorMessage.includes('credits')) {
    return {
      videoId: `error_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error:
        'Insufficient Runway credits. Please add credits at https://dev.runwayml.com to generate videos.',
    };
  }

  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
    return {
      videoId: `error_${Date.now()}`,
      status: 'failed',
      progress: 0,
      error: 'Invalid Runway API key. Please check your RUNWAY_API_KEY.',
    };
  }

  return {
    videoId: `error_${Date.now()}`,
    status: 'failed',
    progress: 0,
    error: `Runway video generation failed: ${errorMessage}`,
  };
}
