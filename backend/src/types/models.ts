/**
 * Model Types
 *
 * Database model types matching Supabase schema.
 */

import type { VideoFormat, ProjectStatus, Screenplay } from './api';
export type { VideoFormat } from './api';

/**
 * Project model
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  content_type: string;
  target_duration: number | null;
  model: string | null;
  voiceover_enabled: boolean;
  captions_enabled: boolean;
  thumbnail_url: string | null;
  video_url: string | null;
  script: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Video project model (extended with screenplay)
 */
export interface VideoProject extends Project {
  user_id: string;
  format: VideoFormat;
  screenplay: Screenplay | null;
  background_video_url: string | null;
  output_video_url: string | null;
}

/**
 * Chat history entry
 */
export interface ChatHistoryEntry {
  id: string;
  user_id: string;
  chat_id: string;
  username: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  created_at: string;
}

/**
 * Pexels video cache entry
 */
export interface PexelsVideo {
  id: string;
  query: string;
  video_data: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

/**
 * Project file
 */
export interface ProjectFile {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_size: number;
  created_at: string;
}

/**
 * Video generation result
 */
export interface VideoGenerationResult {
  videoId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  videoUrl?: string;
  videoUrls?: string[];
  error?: string;
}

/**
 * Video generation response
 */
export interface VideoGenerationResponse {
  success: boolean;
  projectId: string;
  screenplay: Screenplay;
  status: ProjectStatus;
  message: string;
  estimatedCompletionTime?: number;
}

// =============================================================================
// Credits & Generation History Types
// =============================================================================

/**
 * User credits model
 */
export interface UserCredits {
  id: string;
  user_id: string;
  total_credits: number;
  used_credits: number;
  plan_type: 'free' | 'starter' | 'pro' | 'enterprise';
  created_at: string;
  updated_at: string;
}

/**
 * Credit transaction types
 */
export type CreditTransactionType =
  | 'video_generation'
  | 'credit_purchase'
  | 'bonus_credits'
  | 'refund'
  | 'subscription_renewal'
  | 'subscription'
  | 'purchase'
  | 'admin_adjustment';

/**
 * Credit transaction model
 */
export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  transaction_type: CreditTransactionType;
  description: string;
  reference_id?: string;
  created_at: string;
}

/**
 * Generation history entry
 */
export interface GenerationHistoryEntry {
  id: string;
  user_id: string;
  project_id: string | null;
  project_name: string;
  generation_type: 'screenplay' | 'video' | 'enhancement';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  credits_used: number;
  format: VideoFormat;
  duration: number;
  thumbnail_url: string | null;
  video_url: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Credits summary for API response
 */
export interface CreditsSummary {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  planType: string;
  recentTransactions: CreditTransaction[];
}

/**
 * Generation history summary for API response
 */
export interface GenerationHistorySummary {
  entries: GenerationHistoryEntry[];
  totalGenerations: number;
  totalCreditsUsed: number;
}

// =============================================================================
// Interest Submissions (Waitlist) Types
// =============================================================================

/**
 * Interest submission status
 */
export type InterestSubmissionStatus = 'pending' | 'approved' | 'rejected';

/**
 * Interest submission database row
 */
export interface InterestSubmissionRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: InterestSubmissionStatus;
  is_beta_user: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Interest submission API response format
 */
export interface InterestSubmission {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: InterestSubmissionStatus;
  isBetaUser: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Interest form data (for submission)
 */
export interface InterestFormData {
  fullName: string;
  email: string;
  phone?: string;
}

/**
 * Interest statistics
 */
export interface InterestStats {
  total: number;
  pending: number;
  approved: number;
  rejected?: number;
  betaUsers: number;
}
