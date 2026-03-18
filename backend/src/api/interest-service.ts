/**
 * Interest Form Service
 * Handles waitlist/interest form submissions via Supabase
 */

import { getServiceClient } from '@/lib/database';
import { logger } from '@/lib/logger';
import type {
  InterestSubmission,
  InterestFormData,
  InterestStats,
  InterestSubmissionStatus,
  InterestSubmissionRow,
} from '@/types/models';

const serviceLogger = logger.child({ service: 'interest' });

const TABLE_NAME = 'interest_submissions';

export type { InterestSubmission, InterestFormData, InterestStats, InterestSubmissionStatus };

/**
 * Transform database row to API response format
 */
function toApiFormat(row: InterestSubmissionRow): InterestSubmission {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    earlyAccessPriority: row.early_access_priority,
    videoTopics: row.video_topics,
    useCase: row.use_case,
    aiExperience: row.ai_experience,
    biggestChallenge: row.biggest_challenge ?? null,
    exportNeeds: row.export_needs ?? null,
    status: row.status,
    isBetaUser: row.is_beta_user,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Submit interest form to join the waitlist (saves to Supabase)
 */
export async function submitInterestForm(data: InterestFormData): Promise<InterestSubmission> {
  const supabase = getServiceClient();

  try {
    // Check if email already exists
    const { data: existing, error: checkError } = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('email', data.email)
      .maybeSingle();

    if (checkError) {
      serviceLogger.warn('Error checking for existing email', { error: checkError.message });
    }

    if (existing) {
      throw new Error('This email is already on the waitlist!');
    }

    // Insert new submission
    const { data: submission, error } = await supabase
      .from(TABLE_NAME)
      .insert({
        full_name: data.fullName,
        email: data.email,
        role: data.role,
        early_access_priority: data.earlyAccessPriority,
        video_topics: data.videoTopics && data.videoTopics.length > 0 ? data.videoTopics : null,
        use_case: data.useCase || null,
        ai_experience: data.aiExperience || null,
        biggest_challenge: data.biggestChallenge ?? null,
        export_needs: data.exportNeeds ?? null,
        status: 'pending' as InterestSubmissionStatus,
        is_beta_user: false,
      })
      .select()
      .single();

    if (error) {
      serviceLogger.error('Supabase insert error', { error: error.message });
      throw new Error(error.message || 'Failed to submit interest form');
    }

    serviceLogger.info('Interest form submitted', { email: data.email });

    return toApiFormat(submission as InterestSubmissionRow);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    serviceLogger.error('Interest form submission error', { error: message });
    throw error;
  }
}

/**
 * Get all interest submissions (admin only)
 */
export async function getInterestSubmissions(): Promise<InterestSubmission[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Failed to fetch submissions');
  }

  return (data || []).map((row) => toApiFormat(row as InterestSubmissionRow));
}

/**
 * Get a single submission by ID
 */
export async function getInterestSubmissionById(id: string): Promise<InterestSubmission | null> {
  const supabase = getServiceClient();

  const { data, error } = await supabase.from(TABLE_NAME).select('*').eq('id', id).maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to fetch submission');
  }

  return data ? toApiFormat(data as InterestSubmissionRow) : null;
}

/**
 * Get waitlist statistics
 */
export async function getInterestStats(): Promise<InterestStats> {
  const supabase = getServiceClient();

  const { count: total } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true });

  const { count: pending } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: approved } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved');

  const { count: rejected } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'rejected');

  const { count: betaUsers } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('is_beta_user', true);

  return {
    total: total || 0,
    pending: pending || 0,
    approved: approved || 0,
    rejected: rejected || 0,
    betaUsers: betaUsers || 0,
  };
}

/**
 * Update submission status (admin only)
 */
export async function updateSubmissionStatus(
  id: string,
  status: InterestSubmissionStatus,
  isBetaUser?: boolean
): Promise<InterestSubmission> {
  const supabase = getServiceClient();

  const updateData: Record<string, unknown> = { status };
  if (isBetaUser !== undefined) {
    updateData.is_beta_user = isBetaUser;
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update submission');
  }

  serviceLogger.info('Submission status updated', { id, status, isBetaUser });

  return toApiFormat(data as InterestSubmissionRow);
}

/**
 * Delete a submission (admin only)
 */
export async function deleteSubmission(id: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id);

  if (error) {
    throw new Error(error.message || 'Failed to delete submission');
  }

  serviceLogger.info('Submission deleted', { id });
}

export const interestService = {
  submitInterestForm,
  getInterestSubmissions,
  getInterestSubmissionById,
  getInterestStats,
  updateSubmissionStatus,
  deleteSubmission,
};
