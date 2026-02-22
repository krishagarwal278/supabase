/**
 * Test Fixtures - Screenplays
 */

import type { Screenplay, VideoGenerationRequest } from '@/types/api';

export const mockScreenplay: Screenplay = {
  title: 'Test Video',
  format: 'reel',
  totalDuration: 30,
  scenes: [
    {
      sceneNumber: 1,
      duration: 10,
      visualDescription: 'Opening scene with beautiful landscape',
      narration: 'Welcome to our journey',
      transition: 'fade',
    },
    {
      sceneNumber: 2,
      duration: 10,
      visualDescription: 'Person walking through forest',
      narration: 'Discover the beauty of nature',
      transition: 'cut',
    },
    {
      sceneNumber: 3,
      duration: 10,
      visualDescription: 'Sunset over mountains',
      narration: 'Thank you for watching',
      transition: 'fade',
    },
  ],
  voiceoverStyle: 'Calm and inspiring',
  musicSuggestion: 'Ambient nature sounds',
};

export const mockVideoGenerationRequest: VideoGenerationRequest = {
  projectName: 'Nature Documentary',
  format: 'reel',
  targetDuration: 30,
  topic: 'Beautiful nature scenes',
  aiModel: 'gpt-4o',
  enableVoiceover: true,
  enableCaptions: false,
  userId: 'user-123',
};
