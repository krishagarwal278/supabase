/**
 * OpenAI Service
 *
 * Handles all OpenAI API interactions for screenplay generation.
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG, FORMAT_CONFIG } from '@/config/constants';
import { getEnv } from '@/config/env';
import { ExternalServiceError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { Screenplay, VideoFormat, ScreenplayScene } from '@/types/api';

// Lazy-initialized client
let client: OpenAI | null = null;

/**
 * Get OpenAI client (lazy initialization)
 */
function getClient(): OpenAI {
  if (!client) {
    const env = getEnv();
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    logger.debug('OpenAI client initialized');
  }
  return client;
}

/**
 * Generate a screenplay from a topic
 */
export async function generateScreenplay(
  topic: string,
  format: VideoFormat,
  targetDuration: number,
  enableVoiceover: boolean
): Promise<Screenplay> {
  const serviceLogger = logger.child({ service: 'openai' });
  const formatConfig = FORMAT_CONFIG[format];

  const systemPrompt = buildSystemPrompt(formatConfig, format, enableVoiceover);
  const userPrompt = buildUserPrompt(topic, format, targetDuration, enableVoiceover);

  serviceLogger.info('Generating screenplay', {
    topic,
    format,
    targetDuration,
    enableVoiceover,
  });

  try {
    const response = await getClient().chat.completions.create({
      model: OPENAI_CONFIG.MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: OPENAI_CONFIG.TEMPERATURE,
      max_tokens: OPENAI_CONFIG.MAX_TOKENS,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new ExternalServiceError('OpenAI', 'Empty response received');
    }

    const screenplay = parseScreenplayResponse(content, format, targetDuration, topic);

    serviceLogger.info('Screenplay generated', {
      title: screenplay.title,
      sceneCount: screenplay.scenes.length,
      totalDuration: screenplay.totalDuration,
    });

    return screenplay;
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    serviceLogger.error('Failed to generate screenplay', { error: message });
    throw new ExternalServiceError('OpenAI', `Screenplay generation failed: ${message}`);
  }
}

/**
 * Enhance an existing screenplay based on feedback
 */
export async function enhanceScreenplay(
  screenplay: Screenplay,
  feedback: string
): Promise<Screenplay> {
  const serviceLogger = logger.child({ service: 'openai' });

  serviceLogger.info('Enhancing screenplay', {
    title: screenplay.title,
    feedbackLength: feedback.length,
  });

  try {
    const response = await getClient().chat.completions.create({
      model: OPENAI_CONFIG.MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a screenplay editor. Improve the given screenplay based on feedback.
Respond ONLY with valid JSON matching the original screenplay structure.`,
        },
        {
          role: 'user',
          content: `Current screenplay:
${JSON.stringify(screenplay, null, 2)}

Feedback to incorporate: "${feedback}"

Please improve the screenplay based on this feedback.`,
        },
      ],
      temperature: OPENAI_CONFIG.TEMPERATURE,
      max_tokens: OPENAI_CONFIG.MAX_TOKENS,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new ExternalServiceError('OpenAI', 'Empty response received');
    }

    const enhanced = JSON.parse(content) as Screenplay;

    serviceLogger.info('Screenplay enhanced', {
      title: enhanced.title,
      sceneCount: enhanced.scenes.length,
    });

    return enhanced;
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    serviceLogger.error('Failed to enhance screenplay', { error: message });
    throw new ExternalServiceError('OpenAI', `Screenplay enhancement failed: ${message}`);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function buildSystemPrompt(
  formatConfig: (typeof FORMAT_CONFIG)[VideoFormat],
  format: VideoFormat,
  enableVoiceover: boolean
): string {
  return `You are an expert video screenplay writer specializing in ${formatConfig.description}.
Your task is to create engaging, well-structured screenplays that can be turned into compelling AI-generated videos.

Key guidelines:
- Pacing: ${formatConfig.pacing}
- Style: ${formatConfig.style}
- CRITICAL: Visual descriptions must be PURE VISUALS ONLY - describe scenes, people, objects, actions, lighting, camera angles
- DO NOT include any text, titles, words, captions, or letters in visual descriptions - AI video cannot render text properly
- Focus on cinematic imagery: nature scenes, people doing activities, objects, emotions shown through visuals
- ${enableVoiceover ? 'Include natural, conversational narration for voiceover (this will be added separately)' : 'Focus on visual storytelling'}
- Include transition suggestions between scenes
- Text overlays will be added in post-production, not by AI video

Respond ONLY with valid JSON matching this structure:
{
  "title": "string",
  "format": "${format}",
  "totalDuration": number,
  "scenes": [
    {
      "sceneNumber": number,
      "duration": number,
      "visualDescription": "string",
      "narration": "string",
      "textOverlay": "string or null",
      "transition": "string"
    }
  ],
  "voiceoverStyle": "string describing the tone/voice",
  "musicSuggestion": "string suggesting background music style"
}`;
}

function buildUserPrompt(
  topic: string,
  format: VideoFormat,
  targetDuration: number,
  enableVoiceover: boolean
): string {
  return `Create a screenplay for a ${targetDuration}-second ${format.replace('_', ' ')} video about: "${topic}"

Requirements:
- Total duration should be approximately ${targetDuration} seconds
- Break into logical scenes (typically 3-8 scenes depending on duration)
- Each scene duration should add up to roughly the target duration
- Make it engaging and suitable for the ${format.replace('_', ' ')} format
- ${enableVoiceover ? 'Include compelling voiceover narration' : 'Design for visual storytelling'}
- IMPORTANT: Visual descriptions should be cinematic imagery ONLY - NO TEXT, NO TITLES, NO WORDS
- Describe what the camera sees: people, places, objects, actions, emotions, lighting
- Example good visual: "Person reading a book in cozy cafe, warm lighting, steam rising from coffee"
- Example bad visual: "Text appears saying 'Chapter 1'" (AI cannot render text)`;
}

function parseScreenplayResponse(
  content: string,
  format: VideoFormat,
  targetDuration: number,
  topic: string
): Screenplay {
  try {
    const parsed = JSON.parse(content);

    return {
      title: parsed.title || `${topic} - ${format}`,
      format: format,
      totalDuration: parsed.totalDuration || targetDuration,
      scenes: (parsed.scenes || []).map((scene: ScreenplayScene, index: number) => ({
        sceneNumber: scene.sceneNumber || index + 1,
        duration: scene.duration || Math.floor(targetDuration / (parsed.scenes?.length || 1)),
        visualDescription: scene.visualDescription || '',
        narration: scene.narration || '',
        textOverlay: scene.textOverlay || undefined,
        transition: scene.transition || 'cut',
      })),
      voiceoverStyle: parsed.voiceoverStyle,
      musicSuggestion: parsed.musicSuggestion,
    };
  } catch (error) {
    logger.error('Failed to parse screenplay JSON', { content: content.substring(0, 200) });
    throw new ExternalServiceError('OpenAI', 'Failed to parse screenplay from AI response');
  }
}
