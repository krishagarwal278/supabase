/**
 * Video Service
 *
 * Business logic for video generation operations.
 * Orchestrates OpenAI and Runway services.
 */

import * as chatService from './chat.service';
import * as creditsService from './credits.service';
import * as falService from './fal.service';
import * as historyService from './history.service';
import * as openaiService from './openai.service';
import * as projectService from './project.service';
import * as rateLimitService from './ratelimit.service';
import * as rolesService from './roles.service';
import { TABLES, PROJECT_STATUS, RATE_LIMIT_ACTIONS, USER_ROLES } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, ValidationError, InsufficientCreditsError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  VideoGenerationRequest,
  EnhanceScreenplayRequest,
  GenerateVideoRequest,
  Screenplay,
} from '@/types/api';
import { VideoGenerationResult, VideoGenerationResponse, RateLimitInfo } from '@/types/models';

const serviceLogger = logger.child({ service: 'video' });

/**
 * Generate screenplay from a topic
 * Includes rate limiting check (screenplays are free but rate-limited)
 */
export async function generateScreenplay(
  request: VideoGenerationRequest
): Promise<VideoGenerationResponse & { rateLimitInfo?: RateLimitInfo }> {
  const {
    projectId,
    format,
    targetDuration,
    topic,
    enableVoiceover,
    userId,
    aiModel,
    documentContent,
  } = request;

  const duration = targetDuration || 30;

  serviceLogger.info('Generating screenplay', {
    topic,
    format,
    duration,
    userId,
    aiModel: aiModel || 'default',
    hasDocumentContent: !!documentContent,
  });

  // Check rate limit for screenplay generation (free but limited)
  if (userId) {
    await rateLimitService.enforceRateLimit(userId, RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION);
  }

  // Generate screenplay using OpenAI with selected model
  const screenplay = await openaiService.generateScreenplay(
    topic,
    format,
    duration,
    enableVoiceover ?? true,
    aiModel,
    documentContent
  );

  serviceLogger.info('Screenplay generated', {
    title: screenplay.title,
    sceneCount: screenplay.scenes.length,
  });

  // Log action for rate limiting
  if (userId) {
    await rateLimitService.logAction(userId, RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION);
  }

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

  // Get rate limit info for response headers
  let rateLimitInfo: RateLimitInfo | undefined;
  if (userId) {
    rateLimitInfo = await rateLimitService.getRateLimitHeaders(
      userId,
      RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION
    );
  }

  return {
    success: true,
    projectId: projectId || `screenplay_${Date.now()}`,
    screenplay,
    status: PROJECT_STATUS.SCREENPLAY_GENERATED,
    message: 'Screenplay generated successfully. Ready for video processing.',
    estimatedCompletionTime: duration * 2,
    rateLimitInfo,
  };
}

/**
 * Enhance an existing screenplay with feedback
 */
export async function enhanceScreenplay(
  request: EnhanceScreenplayRequest & { userId?: string; aiModel?: string }
): Promise<{ screenplay: Screenplay; version?: number }> {
  const { projectId, screenplay, feedback, userId, aiModel } = request;

  serviceLogger.info('Enhancing screenplay', {
    title: screenplay.title,
    feedbackLength: feedback.length,
    aiModel: aiModel || 'default',
  });

  const enhanced = await openaiService.enhanceScreenplay(screenplay, feedback, aiModel);

  // Store enhanced version
  await storeEnhancedScreenplayInHistory(projectId, enhanced);

  // Save version if we have project and user context
  let version: number | undefined;
  if (projectId && userId) {
    try {
      const versionResult = await chatService.saveScreenplayVersion({
        projectId,
        userId,
        screenplay: enhanced as unknown as Record<string, unknown>,
        changeSummary: feedback.substring(0, 200),
      });
      version = versionResult.version;
    } catch (error) {
      serviceLogger.warn('Failed to save screenplay version', { error });
    }
  }

  return { screenplay: enhanced, version };
}

/**
 * Generate video from screenplay
 * Checks credits AND rate limits before generation
 * Deducts credits on success, logs action for rate limiting
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
  rateLimitInfo?: RateLimitInfo;
}> {
  const { projectId, screenplay, userId: rawUserId } = request;

  // Validate userId is present for credit tracking
  if (!rawUserId) {
    throw new ValidationError('User ID is required for video generation');
  }
  const userId = rawUserId;

  // Get user role for logging
  const userRole = await rolesService.getUserRole(userId);

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
    userRole,
  });

  // 1. Check rate limits first (throws RateLimitError if exceeded)
  await rateLimitService.enforceRateLimit(userId, RATE_LIMIT_ACTIONS.VIDEO_GENERATION);

  // 2. Check if user has enough credits (admins bypass)
  if (userRole !== USER_ROLES.ADMIN) {
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
  }

  // Create history entry (pending)
  const historyEntry = await historyService.createHistoryEntry({
    userId,
    projectId: projectId || undefined,
    projectName,
    generationType: 'video',
    format: screenplay.format,
    duration: screenplay.totalDuration,
    creditsUsed: userRole === USER_ROLES.ADMIN ? 0 : creditCost,
    metadata: {
      sceneCount: screenplay.scenes.length,
      voiceoverStyle: screenplay.voiceoverStyle,
      userRole,
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

    // 3. Deduct credits on successful generation (admins bypass)
    let remainingCredits = 0;
    if (userRole !== USER_ROLES.ADMIN) {
      const deductResult = await creditsService.deductCredits(
        userId,
        creditCost,
        'video_generation',
        `Video generation: ${projectName}`,
        historyEntryId
      );
      remainingCredits = deductResult.remainingCredits;
    } else {
      // For admins, get current balance without deducting
      const adminCredits = await creditsService.getUserCredits(userId);
      remainingCredits = adminCredits.total_credits - adminCredits.used_credits;
    }

    // 4. Log action for rate limiting
    await rateLimitService.logAction(userId, RATE_LIMIT_ACTIONS.VIDEO_GENERATION);

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

    // Get rate limit info for response
    const rateLimitInfo = await rateLimitService.getRateLimitHeaders(
      userId,
      RATE_LIMIT_ACTIONS.VIDEO_GENERATION
    );

    return {
      videoId: result.videoId,
      status: result.status,
      videoUrl: result.videoUrl,
      videoUrls: result.videoUrls,
      clipCount: result.videoUrls?.length || 1,
      progress: result.progress,
      creditsUsed: userRole === USER_ROLES.ADMIN ? 0 : creditCost,
      remainingCredits,
      rateLimitInfo,
    };
  } catch (error) {
    // Mark history as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await historyService.markAsFailed(historyEntryId, errorMessage);

    // Note: Credits are NOT deducted on failure, and rate limit action is NOT logged
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
