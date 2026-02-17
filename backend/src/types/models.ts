/**
 * Model Types
 *
 * Database model types matching Supabase schema.
 */

import { VideoFormat, ProjectStatus, Screenplay } from './api';

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
