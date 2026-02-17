/**
 * Test Fixtures - Projects
 */

import type { CreateProjectRequest } from '@/types/api';
import type { Project } from '@/types/models';

export const mockProject: Project = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Project',
  description: 'A test project description',
  status: 'draft',
  content_type: 'video',
  target_duration: 60,
  model: 'gpt-4.1',
  voiceover_enabled: true,
  captions_enabled: false,
  thumbnail_url: null,
  video_url: null,
  script: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

export const mockCreateProjectRequest: CreateProjectRequest = {
  name: 'New Project',
  description: 'Project description',
  content_type: 'video',
};

export const mockProjects: Project[] = [
  mockProject,
  {
    ...mockProject,
    id: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Second Project',
    status: 'completed',
  },
  {
    ...mockProject,
    id: '123e4567-e89b-12d3-a456-426614174002',
    name: 'Third Project',
    status: 'processing',
  },
];
