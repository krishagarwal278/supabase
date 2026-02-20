/**
 * Video Service
 *
 * Business logic for video generation operations.
 * Orchestrates OpenAI and Runway services.
 */

import * as creditsService from './credits.service';
import * as falService from './fal.service';
import * as historyService from './history.service';
import * as openaiService from './openai.service';
import * as projectService from './project.service';
import { TABLES, PROJECT_STATUS } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, ValidationError, InsufficientCreditsError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  VideoGenerationRequest,
  EnhanceScreenplayRequest,
  GenerateVideoRequest,
  Screenplay,
} from '@/types/api';
import { VideoGenerationResult, VideoGenerationResponse } from '@/types/models';

const serviceLogger = logger.child({ service: 'video' });

/**
 * Generate screenplay from a topic
 */
export async function generateScreenplay(
  request: VideoGenerationRequest
): Promise<VideoGenerationResponse> {
  const { projectId, format, targetDuration, topic, enableVoiceover, userId } = request;

  const duration = targetDuration || 30;

  serviceLogger.info('Generating screenplay', {
    topic,
    format,
    duration,
    userId,
  });

  // Generate screenplay using OpenAI
  const screenplay = await openaiService.generateScreenplay(
    topic,
    format,
    duration,
    enableVoiceover ?? true
  );

  serviceLogger.info('Screenplay generated', {
    title: screenplay.title,
    sceneCount: screenplay.scenes.length,
  });

  // Store screenplay in chat_history
  await storeScreenplayInHistory(userId, projectId, screenplay);

  // Update project status if projectId provided
  if (projectId) {
    try {
      await projectService.updateProjectStatus(projectId, PROJECT_STATUS.SCREENPLAY_GENERATED);
    } catch (error) {
      serviceLogger.warn('Failed to update project status', { projectId, error });
    }
  }

  return {
    success: true,
    projectId: projectId || `screenplay_${Date.now()}`,
    screenplay,
    status: PROJECT_STATUS.SCREENPLAY_GENERATED,
    message: 'Screenplay generated successfully. Ready for video processing.',
    estimatedCompletionTime: duration * 2,
  };
}

/**
 * Enhance an existing screenplay with feedback
 */
export async function enhanceScreenplay(
  request: EnhanceScreenplayRequest
): Promise<{ screenplay: Screenplay }> {
  const { projectId, screenplay, feedback } = request;

  serviceLogger.info('Enhancing screenplay', {
    title: screenplay.title,
    feedbackLength: feedback.length,
  });

  const enhanced = await openaiService.enhanceScreenplay(screenplay, feedback);

  // Store enhanced version
  await storeEnhancedScreenplayInHistory(projectId, enhanced);

  return { screenplay: enhanced };
}

/**
 * Generate video from screenplay
 * Checks credits before generation and deducts on success
 */
export async function generateVideo(request: GenerateVideoRequest): Promise<{
  videoId: string;
  status: string;
  videoUrl?: string;
  videoUrls?: string[];
  clipCount: number;
  progress: number;
  creditsUsed: number;
  remainingCredits: number;
}> {
  const { projectId, screenplay, userId: rawUserId } = request;

  // Validate userId is present for credit tracking
  if (!rawUserId) {
    throw new ValidationError('User ID is required for video generation');
  }
  const userId = rawUserId;

  // Get project name for history
  let projectName = screenplay.title || 'Untitled Video';
  if (projectId) {
    try {
      const project = await projectService.getProjectById(projectId);
      if (project) {
        projectName = project.name;
      }
    } catch {
      // Use screenplay title as fallback
    }
  }

  // Calculate credit cost based on format
  const creditCost = creditsService.getVideoCreditCost(screenplay.format);

  serviceLogger.info('Starting video generation', {
    projectId,
    title: screenplay.title,
    sceneCount: screenplay.scenes.length,
    creditCost,
    userId,
  });

  // Check if user has enough credits with detailed info
  const creditCheck = await creditsService.checkCreditsWithDetails(userId, creditCost);
  if (!creditCheck.hasEnough) {
    const error = creditCheck.error!;
    serviceLogger.warn('Insufficient credits for video generation', {
      userId,
      required: error.required,
      available: error.available,
    });

    throw new InsufficientCreditsError(
      error.required,
      error.available,
      error.suggestedPackage || undefined
    );
  }

  // Create history entry (pending)
  const historyEntry = await historyService.createHistoryEntry({
    userId,
    projectId: projectId || undefined,
    projectName,
    generationType: 'video',
    format: screenplay.format,
    duration: screenplay.totalDuration,
    creditsUsed: creditCost,
    metadata: {
      sceneCount: screenplay.scenes.length,
      voiceoverStyle: screenplay.voiceoverStyle,
    },
  });

  const historyEntryId = historyEntry.id;

  // Store generation request
  const requestId = await storeVideoGenerationRequest(userId, projectId, screenplay);

  try {
    // Mark as processing
    await historyService.markAsProcessing(historyEntryId);

    // Generate video using Fal AI (Ovi model)
    const result = await falService.generateVideoFromScreenplay(screenplay, (progress, status) => {
      serviceLogger.debug('Video progress', { progress, status });
    });

    // Store result
    await storeVideoGenerationResult(userId, requestId, projectId, result);

    // Deduct credits on successful generation
    const deductResult = await creditsService.deductCredits(
      userId,
      creditCost,
      'video_generation',
      `Video generation: ${projectName}`,
      historyEntryId
    );

    // Update history entry based on result
    if (result.videoUrl) {
      await historyService.markAsCompleted(historyEntryId, result.videoUrl);
    }

    // Update project if successful
    if (result.videoUrl && projectId) {
      try {
        await projectService.updateProjectStatus(projectId, PROJECT_STATUS.COMPLETED);
      } catch (error) {
        serviceLogger.warn('Failed to update project status', { projectId, error });
      }
    }

    return {
      videoId: result.videoId,
      status: result.status,
      videoUrl: result.videoUrl,
      videoUrls: result.videoUrls,
      clipCount: result.videoUrls?.length || 1,
      progress: result.progress,
      creditsUsed: creditCost,
      remainingCredits: deductResult.remainingCredits,
    };
  } catch (error) {
    // Mark history as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await historyService.markAsFailed(historyEntryId, errorMessage);

    // Note: Credits are NOT deducted on failure
    serviceLogger.error('Video generation failed', { error: errorMessage, historyEntryId });

    throw error;
  }
}

/**
 * Check video generation status
 */
export async function checkVideoStatus(videoId: string): Promise<VideoGenerationResult> {
  return falService.checkVideoStatus(videoId);
}

/**
 * Get all screenplays for a user
 */
export async function getScreenplays(userId?: string): Promise<
  Array<{
    id: string;
    chatId: string;
    userId: string;
    screenplay: Screenplay;
    createdAt: string;
  }>
> {
  const supabase = getServiceClient();

  // Screenplays are stored by the 'system' username with role 'assistant'
  // They can have chat_id as either 'screenplay_*' or a project UUID
  let query = supabase
    .from(TABLES.CHAT_HISTORY)
    .select('*')
    .eq('username', 'system')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new DatabaseError(`Failed to fetch screenplays: ${error.message}`);
  }

  // Filter to only entries that contain valid screenplay JSON
  const screenplays: Array<{
    id: string;
    chatId: string;
    userId: string;
    screenplay: Screenplay;
    createdAt: string;
  }> = [];

  for (const entry of data || []) {
    try {
      const parsed = JSON.parse(entry.message);
      // Check if it looks like a screenplay (has scenes array)
      if (parsed && Array.isArray(parsed.scenes)) {
        screenplays.push({
          id: entry.id,
          chatId: entry.chat_id,
          userId: entry.user_id,
          screenplay: parsed,
          createdAt: entry.created_at,
        });
      }
    } catch {
      // Not valid JSON or not a screenplay, skip
    }
  }

  return screenplays;
}

/**
 * Get screenplays for a specific project
 */
export async function getProjectScreenplays(projectId: string): Promise<
  Array<{
    id: string;
    chatId: string;
    userId: string;
    screenplay: Screenplay;
    createdAt: string;
  }>
> {
  const supabase = getServiceClient();

  // Screenplays for a project are stored with chat_id = projectId
  const { data, error } = await supabase
    .from(TABLES.CHAT_HISTORY)
    .select('*')
    .eq('chat_id', projectId)
    .eq('username', 'system')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false });

  if (error) {
    throw new DatabaseError(`Failed to fetch project screenplays: ${error.message}`);
  }

  const screenplays: Array<{
    id: string;
    chatId: string;
    userId: string;
    screenplay: Screenplay;
    createdAt: string;
  }> = [];

  for (const entry of data || []) {
    try {
      const parsed = JSON.parse(entry.message);
      if (parsed && Array.isArray(parsed.scenes)) {
        screenplays.push({
          id: entry.id,
          chatId: entry.chat_id,
          userId: entry.user_id,
          screenplay: parsed,
          createdAt: entry.created_at,
        });
      }
    } catch {
      // Not valid JSON or not a screenplay, skip
    }
  }

  return screenplays;
}

// =============================================================================
// Helper Functions
// =============================================================================

async function storeScreenplayInHistory(
  userId: string,
  projectId: string | undefined,
  screenplay: Screenplay
): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: userId,
      chat_id: projectId || `screenplay_${Date.now()}`,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(screenplay, null, 2),
    },
  ]);

  if (error) {
    serviceLogger.warn('Failed to store screenplay in history', { error: error.message });
  }
}

async function storeEnhancedScreenplayInHistory(
  projectId: string | undefined,
  screenplay: Screenplay
): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: projectId || 'anonymous',
      chat_id: `enhanced_${Date.now()}`,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(screenplay, null, 2),
    },
  ]);

  if (error) {
    serviceLogger.warn('Failed to store enhanced screenplay', { error: error.message });
  }
}

async function storeVideoGenerationRequest(
  userId: string | undefined,
  projectId: string | undefined,
  screenplay: Screenplay
): Promise<string> {
  const supabase = getServiceClient();
  const requestId = `video_gen_${Date.now()}`;

  await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: userId || 'anonymous',
      chat_id: requestId,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(
        {
          type: 'video_generation_request',
          projectId,
          screenplay,
          status: 'started',
          requestedAt: new Date().toISOString(),
        },
        null,
        2
      ),
    },
  ]);

  return requestId;
}

async function storeVideoGenerationResult(
  userId: string | undefined,
  requestId: string,
  projectId: string | undefined,
  result: VideoGenerationResult
): Promise<void> {
  const supabase = getServiceClient();

  await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: userId || 'anonymous',
      chat_id: `${requestId}_result`,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(
        {
          type: 'video_generation_result',
          projectId,
          videoId: result.videoId,
          status: result.status,
          videoUrl: result.videoUrl,
          videoUrls: result.videoUrls,
          clipCount: result.videoUrls?.length || 1,
          completedAt: new Date().toISOString(),
        },
        null,
        2
      ),
    },
  ]);
}
