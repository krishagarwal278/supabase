/**
 * Video Service
 *
 * Business logic for video generation operations.
 * Orchestrates OpenAI and Runway services.
 */

import { randomUUID } from 'crypto';
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
    projectId: inputProjectId,
    format,
    targetDuration,
    topic,
    enableVoiceover,
    userId,
    aiModel,
    documentContent,
  } = request;

  // Always use a valid UUID for projectId (generate one if not provided)
  const projectId = inputProjectId || randomUUID();
  const duration = targetDuration || 30;

  serviceLogger.info('Generating screenplay', {
    topic,
    format,
    duration,
    userId,
    projectId,
    aiModel: aiModel || 'default',
    hasDocumentContent: !!documentContent,
    enableVoiceover,
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
    projectId,
  });

  // Log action for rate limiting
  if (userId) {
    await rateLimitService.logAction(userId, RATE_LIMIT_ACTIONS.SCREENPLAY_GENERATION);
  }

  // Store screenplay in chat_history
  await storeScreenplayInHistory(userId, projectId, screenplay);

  // Update project status if inputProjectId was provided (existing project)
  if (inputProjectId) {
    try {
      await projectService.updateProjectStatus(inputProjectId, PROJECT_STATUS.SCREENPLAY_GENERATED);
    } catch (error) {
      serviceLogger.warn('Failed to update project status', { projectId: inputProjectId, error });
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
    projectId,
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
  await storeEnhancedScreenplayInHistory(userId, projectId, enhanced);

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

    const generationSucceeded = !!(result.videoUrl ?? result.videoUrls?.length);

    // 3. Deduct credits only when generation actually produced at least one clip (admins bypass)
    let remainingCredits = 0;
    if (userRole !== USER_ROLES.ADMIN) {
      if (generationSucceeded) {
        const deductResult = await creditsService.deductCredits(
          userId,
          creditCost,
          'video_generation',
          `Video generation: ${projectName}`,
          historyEntryId
        );
        remainingCredits = deductResult.remainingCredits;
      } else {
        await historyService.markAsFailed(historyEntryId, result.error ?? 'No clips generated');
        const currentCredits = await creditsService.getUserCredits(userId);
        remainingCredits = currentCredits.total_credits - currentCredits.used_credits;
      }
    } else {
      const adminCredits = await creditsService.getUserCredits(userId);
      remainingCredits = adminCredits.total_credits - adminCredits.used_credits;
    }

    // 4. Log action for rate limiting only when we actually used credits (generation succeeded)
    if (generationSucceeded) {
      await rateLimitService.logAction(userId, RATE_LIMIT_ACTIONS.VIDEO_GENERATION);
    }

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
 * Get all screenplays for a user from the screenplays table (so History → Slides and Supabase Table Editor show data).
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

  let query = supabase
    .from(TABLES.SCREENPLAYS)
    .select('id, user_id, project_id, title, format, total_duration, scenes, created_at')
    .order('created_at', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new DatabaseError(`Failed to fetch screenplays: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    chatId: row.project_id ?? row.id,
    userId: row.user_id,
    screenplay: {
      title: row.title,
      format: row.format,
      totalDuration: row.total_duration,
      scenes: row.scenes as Screenplay['scenes'],
    } as Screenplay,
    createdAt: row.created_at,
  }));
}

/**
 * Get screenplays for a specific project from the screenplays table.
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

  const { data, error } = await supabase
    .from(TABLES.SCREENPLAYS)
    .select('id, user_id, project_id, title, format, total_duration, scenes, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DatabaseError(`Failed to fetch project screenplays: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    chatId: row.project_id ?? row.id,
    userId: row.user_id,
    screenplay: {
      title: row.title,
      format: row.format,
      totalDuration: row.total_duration,
      scenes: row.scenes as Screenplay['scenes'],
    } as Screenplay,
    createdAt: row.created_at,
  }));
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Insert into the screenplays table (so data appears in Supabase Table Editor and has proper schema) */
async function insertIntoScreenplaysTable(params: {
  userId: string;
  projectId?: string | null;
  title: string;
  format: string;
  totalDuration: number;
  scenes: Screenplay['scenes'];
  sourceChatId?: string | null;
}): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from(TABLES.SCREENPLAYS).insert([
    {
      user_id: params.userId,
      project_id: params.projectId ?? null,
      title: params.title,
      format: params.format,
      total_duration: params.totalDuration,
      scenes: params.scenes as unknown as Record<string, unknown>[],
      source_chat_id: params.sourceChatId ?? null,
    },
  ]);
  if (error) {
    serviceLogger.warn('Failed to insert into screenplays table', { error: error.message });
  }
}

async function storeScreenplayInHistory(
  userId: string,
  projectId: string,
  screenplay: Screenplay
): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: userId,
      chat_id: projectId,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(screenplay, null, 2),
    },
  ]);

  if (error) {
    serviceLogger.warn('Failed to store screenplay in history', { error: error.message });
  }

  await insertIntoScreenplaysTable({
    userId,
    projectId,
    title: screenplay.title,
    format: screenplay.format,
    totalDuration: screenplay.totalDuration,
    scenes: screenplay.scenes,
    sourceChatId: projectId,
  });
}

async function storeEnhancedScreenplayInHistory(
  userId: string | undefined,
  projectId: string | undefined,
  screenplay: Screenplay
): Promise<void> {
  const supabase = getServiceClient();
  const chatId = projectId || randomUUID();

  const { error } = await supabase.from(TABLES.CHAT_HISTORY).insert([
    {
      user_id: userId || 'anonymous',
      chat_id: chatId,
      username: 'system',
      role: 'assistant',
      message: JSON.stringify(screenplay, null, 2),
    },
  ]);

  if (error) {
    serviceLogger.warn('Failed to store enhanced screenplay', { error: error.message });
  }

  if (userId) {
    await insertIntoScreenplaysTable({
      userId,
      projectId: projectId ?? null,
      title: screenplay.title,
      format: screenplay.format,
      totalDuration: screenplay.totalDuration,
      scenes: screenplay.scenes,
      sourceChatId: projectId ?? undefined,
    });
  }
}

async function storeVideoGenerationRequest(
  userId: string | undefined,
  projectId: string | undefined,
  screenplay: Screenplay
): Promise<string> {
  const supabase = getServiceClient();
  const requestId = randomUUID();

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

/**
 * Persist a generated slideshow to the slideshows table only (not screenplays or chat_history).
 * Stores just the slides (images + metadata); input content/context from the frontend is not stored.
 */
export async function persistSlideshow(params: {
  userId: string;
  projectId?: string;
  title?: string;
  slides: Array<{
    slideNumber: number;
    title: string;
    bulletPoints?: string[];
    narration?: string;
    visualDescription?: string;
    imageUrl?: string;
  }>;
  slideDuration: number;
}): Promise<void> {
  const { userId, projectId, title, slides, slideDuration } = params;
  const totalDuration = slides.length * slideDuration;

  const supabase = getServiceClient();
  const { error } = await supabase.from(TABLES.SLIDESHOWS).insert([
    {
      user_id: userId,
      project_id: projectId ?? null,
      title: title ?? null,
      slide_count: slides.length,
      total_duration: totalDuration,
      slides: slides as unknown as Record<string, unknown>[],
    },
  ]);

  if (error) {
    serviceLogger.warn('Failed to persist slideshow', { error: error.message });
  } else {
    serviceLogger.info('Slideshow persisted', { userId, projectId, slideCount: slides.length });
  }
}

/** Return type for a single slideshow from the table */
export type StoredSlideshow = {
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  slideCount: number;
  totalDuration: number;
  slides: Array<{
    slideNumber: number;
    title: string;
    bulletPoints?: string[];
    narration?: string;
    visualDescription?: string;
    imageUrl?: string;
  }>;
  createdAt: string;
};

/**
 * Get all slideshows for a user (from slideshows table).
 */
export async function getSlideshows(userId?: string): Promise<StoredSlideshow[]> {
  const supabase = getServiceClient();

  let query = supabase
    .from(TABLES.SLIDESHOWS)
    .select('*')
    .order('created_at', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new DatabaseError(`Failed to fetch slideshows: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    slideCount: row.slide_count,
    totalDuration: row.total_duration,
    slides: (row.slides || []) as StoredSlideshow['slides'],
    createdAt: row.created_at,
  }));
}

/**
 * Get slideshows for a specific project (from slideshows table).
 */
export async function getProjectSlideshows(projectId: string): Promise<StoredSlideshow[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.SLIDESHOWS)
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DatabaseError(`Failed to fetch project slideshows: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    slideCount: row.slide_count,
    totalDuration: row.total_duration,
    slides: (row.slides || []) as StoredSlideshow['slides'],
    createdAt: row.created_at,
  }));
}
