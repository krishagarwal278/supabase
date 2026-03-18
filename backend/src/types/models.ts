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
  user_id?: string | null;
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
 * User role options for interest form
 */
export type InterestUserRole =
  | 'student'
  | 'self_learner'
  | 'educator'
  | 'educator_professor'
  | 'content_creator'
  | 'teachable_creator'
  | 'udemy_instructor'
  | 'coursera_creator'
  | 'corporate_trainer'
  | 'instructional_designer'
  | 'certification_body'
  | 'professional'
  | 'developer'
  | 'solopreneur'
  | 'other';

/**
 * Early access priority/interest level + "Courses created" dropdown values
 */
export type EarlyAccessPriority =
  | 'very_interested'
  | 'somewhat_interested'
  | 'just_exploring'
  | 'planning_my_first_course'
  | 'one_to_ten_courses'
  | 'power_creator'
  | 'few_courses'
  | 'many_courses'
  | 'scale_courses';

/**
 * Video topics / What do you teach? (frontend tags + legacy)
 */
export type VideoTopic =
  | 'technical_skills'
  | 'business_finance'
  | 'academic'
  | 'academic_subjects'
  | 'creative_skills'
  | 'creative_design'
  | 'language_learning'
  | 'languages'
  | 'career_prep'
  | 'professional_certs'
  | 'personal_development'
  | 'personal_dev'
  | 'programming_tech';

/**
 * Use case options (optional; frontend may not show this field)
 */
export type UseCase =
  | 'create_learning_videos'
  | 'summarize_concepts'
  | 'study_faster'
  | 'build_courses'
  | 'content_creation'
  | 'experimenting';

/**
 * AI experience level
 */
export type AiExperience = 'beginner' | 'intermediate' | 'advanced' | 'power_user';

/**
 * Biggest challenge? (optional) — frontend dropdown
 */
export type BiggestChallenge =
  | 'recording_takes_too_long'
  | 'editing_tedious'
  | 'voice_quality_issues'
  | 'keeping_content_updated'
  | 'scaling_content'
  | 'production_costs';

/**
 * Export needs (optional) — frontend dropdown
 */
export type ExportNeeds = 'udemy_mp4' | 'scorm_lms' | 'coursera_format' | 'multiple_platforms';

/**
 * Interest submission database row
 */
export interface InterestSubmissionRow {
  id: string;
  full_name: string;
  email: string;
  role: InterestUserRole;
  early_access_priority: EarlyAccessPriority;
  video_topics: VideoTopic[] | null;
  use_case: UseCase | null;
  ai_experience: AiExperience | null;
  biggest_challenge: BiggestChallenge | null;
  export_needs: ExportNeeds | null;
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
  role: InterestUserRole;
  earlyAccessPriority: EarlyAccessPriority;
  videoTopics: VideoTopic[] | null;
  useCase: UseCase | null;
  aiExperience: AiExperience | null;
  biggestChallenge: BiggestChallenge | null;
  exportNeeds: ExportNeeds | null;
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
  role: InterestUserRole;
  earlyAccessPriority: EarlyAccessPriority;
  videoTopics?: VideoTopic[];
  useCase?: UseCase;
  aiExperience?: AiExperience;
  biggestChallenge?: BiggestChallenge;
  exportNeeds?: ExportNeeds;
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
  byRole?: Record<InterestUserRole, number>;
  byPriority?: Record<EarlyAccessPriority, number>;
}

// =============================================================================
// User Roles Types
// =============================================================================

/**
 * User role type
 */
export type UserRoleType = 'user' | 'beta_tester' | 'admin';

/**
 * User role database row
 */
export interface UserRoleRow {
  user_id: string;
  role: UserRoleType;
  granted_at: string;
  granted_by: string | null;
  beta_expires_at: string | null;
}

/**
 * User role API response
 */
export interface UserRoleInfo {
  userId: string;
  role: UserRoleType;
  grantedAt: string;
  grantedBy: string | null;
  betaExpiresAt: string | null;
  isBetaExpired: boolean;
}

// =============================================================================
// Rate Limiting Types
// =============================================================================

/**
 * Rate limit action type
 */
export type RateLimitActionType =
  | 'video_generation'
  | 'screenplay_generation'
  | 'screenplay_enhancement';

/**
 * Rate limit tracking row
 */
export interface RateLimitTrackingRow {
  id: string;
  user_id: string;
  action_type: RateLimitActionType;
  created_at: string;
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  periodType: 'hourly' | 'daily' | 'period';
}

/**
 * Rate limit info for API headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
}
