/**
 * Generation History Service
 *
 * Tracks all video generation attempts for users.
 */

import { TABLES } from '@/config/constants';
import { getServiceClient } from '@/lib/database';
import { DatabaseError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { VideoFormat } from '@/types/api';
import type { GenerationHistoryEntry, GenerationHistorySummary } from '@/types/models';

const historyLogger = logger.child({ service: 'history' });

// =============================================================================
// Generation History Management
// =============================================================================

export interface CreateHistoryEntryParams {
  userId: string;
  projectId?: string;
  projectName: string;
  generationType: 'screenplay' | 'video' | 'enhancement';
  format: VideoFormat;
  duration: number;
  creditsUsed: number;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new generation history entry (starts as pending)
 */
export async function createHistoryEntry(
  params: CreateHistoryEntryParams
): Promise<GenerationHistoryEntry> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .insert({
      user_id: params.userId,
      project_id: params.projectId || null,
      project_name: params.projectName,
      generation_type: params.generationType,
      status: 'pending',
      credits_used: params.creditsUsed,
      format: params.format,
      duration: params.duration,
      metadata: params.metadata || {},
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to create history entry: ${error.message}`);
  }

  historyLogger.info('History entry created', {
    id: data.id,
    userId: params.userId,
    type: params.generationType,
  });

  return data as GenerationHistoryEntry;
}

/**
 * Update history entry status to processing
 */
export async function markAsProcessing(entryId: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .update({ status: 'processing' })
    .eq('id', entryId);

  if (error) {
    historyLogger.warn('Failed to mark entry as processing', { entryId, error: error.message });
  }
}

/**
 * Mark history entry as completed
 */
export async function markAsCompleted(
  entryId: string,
  videoUrl: string,
  thumbnailUrl?: string
): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .update({
      status: 'completed',
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl || null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', entryId);

  if (error) {
    historyLogger.warn('Failed to mark entry as completed', { entryId, error: error.message });
  }

  historyLogger.info('Generation completed', { entryId, videoUrl });
}

/**
 * Mark history entry as failed
 */
export async function markAsFailed(entryId: string, errorMessage: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', entryId);

  if (error) {
    historyLogger.warn('Failed to mark entry as failed', { entryId, error: error.message });
  }

  historyLogger.warn('Generation failed', { entryId, errorMessage });
}

// =============================================================================
// History Retrieval
// =============================================================================

/**
 * Get generation history for a user
 */
export async function getGenerationHistory(
  userId: string,
  options: {
    page?: number;
    pageSize?: number;
    generationType?: 'screenplay' | 'video' | 'enhancement';
    status?: 'pending' | 'processing' | 'completed' | 'failed';
  } = {}
): Promise<GenerationHistorySummary> {
  const supabase = getServiceClient();
  const { page = 1, pageSize = 20, generationType, status } = options;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (generationType) {
    query = query.eq('generation_type', generationType);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query.range(offset, offset + pageSize - 1);

  if (error) {
    throw new DatabaseError(`Failed to fetch generation history: ${error.message}`);
  }

  // Calculate total credits used
  const { data: creditsData } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('credits_used')
    .eq('user_id', userId);

  const totalCreditsUsed = (creditsData || []).reduce(
    (sum, entry) => sum + (entry.credits_used || 0),
    0
  );

  return {
    entries: (data || []) as GenerationHistoryEntry[],
    totalGenerations: count || 0,
    totalCreditsUsed,
  };
}

/**
 * Get video generation history only (for gallery view)
 */
export async function getVideoHistory(
  userId: string,
  page: number = 1,
  pageSize: number = 12
): Promise<{
  videos: GenerationHistoryEntry[];
  total: number;
  hasMore: boolean;
}> {
  const supabase = getServiceClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('generation_type', 'video')
    .in('status', ['completed', 'processing', 'pending'])
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new DatabaseError(`Failed to fetch video history: ${error.message}`);
  }

  const total = count || 0;

  return {
    videos: (data || []) as GenerationHistoryEntry[],
    total,
    hasMore: offset + pageSize < total,
  };
}

/**
 * Get a single history entry by ID
 */
export async function getHistoryEntry(entryId: string): Promise<GenerationHistoryEntry | null> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('*')
    .eq('id', entryId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new DatabaseError(`Failed to fetch history entry: ${error.message}`);
  }

  return data as GenerationHistoryEntry;
}

/**
 * Get recent generations for dashboard
 */
export async function getRecentGenerations(
  userId: string,
  limit: number = 5
): Promise<GenerationHistoryEntry[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DatabaseError(`Failed to fetch recent generations: ${error.message}`);
  }

  return (data || []) as GenerationHistoryEntry[];
}

/**
 * Get generation statistics for a user
 */
export async function getGenerationStats(userId: string): Promise<{
  totalVideos: number;
  totalScreenplays: number;
  completedVideos: number;
  failedVideos: number;
  totalCreditsUsed: number;
}> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.GENERATION_HISTORY)
    .select('generation_type, status, credits_used')
    .eq('user_id', userId);

  if (error) {
    throw new DatabaseError(`Failed to fetch generation stats: ${error.message}`);
  }

  const entries = data || [];

  return {
    totalVideos: entries.filter((e) => e.generation_type === 'video').length,
    totalScreenplays: entries.filter((e) => e.generation_type === 'screenplay').length,
    completedVideos: entries.filter(
      (e) => e.generation_type === 'video' && e.status === 'completed'
    ).length,
    failedVideos: entries.filter((e) => e.generation_type === 'video' && e.status === 'failed')
      .length,
    totalCreditsUsed: entries.reduce((sum, e) => sum + (e.credits_used || 0), 0),
  };
}
