/**
 * Image Generation Service
 *
 * Generates images using fal.ai FLUX model for slideshow slides.
 * Uses GPT-4o-mini to create contextually relevant image prompts.
 * FLUX is much more reliable than video generation for text/educational content.
 */

import fetch, { Headers, Request, Response } from 'node-fetch';
import OpenAI from 'openai';
import { ExternalServiceError, ServiceUnavailableError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const g = globalThis as unknown as Record<string, unknown>;
if (!g.fetch) {
  g.fetch = fetch;
  g.Headers = Headers;
  g.Request = Request;
  g.Response = Response;
}

let fal: typeof import('@fal-ai/client').fal;
let openaiClient: OpenAI | null = null;

const serviceLogger = logger.child({ service: 'image-generation' });

let isConfigured = false;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new ServiceUnavailableError('OpenAI', 'API key not configured');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function initializeFalClient(): Promise<void> {
  if (isConfigured && fal) {
    return;
  }

  const apiKey = process.env['FAL_AI_API_KEY'];
  if (!apiKey) {
    throw new ServiceUnavailableError('Fal AI', 'API key not configured');
  }

  const falModule = await import('@fal-ai/client');
  fal = falModule.fal;

  fal.config({
    credentials: apiKey,
  });

  isConfigured = true;
  serviceLogger.debug('Fal AI client initialized for image generation');
}

export function isFalConfigured(): boolean {
  return !!process.env['FAL_AI_API_KEY'];
}

export interface SlideContent {
  title: string;
  bulletPoints: string[];
  visualDescription: string;
  slideNumber: number;
}

export interface GeneratedSlide {
  slideNumber: number;
  imageUrl: string;
  title: string;
  content: string[];
}

/**
 * FLUX models available for image generation
 */
const FLUX_MODELS = {
  schnell: 'fal-ai/flux/schnell', // Fast, ~$0.003 per image
  dev: 'fal-ai/flux/dev', // Higher quality, ~$0.025 per image
} as const;

/**
 * Style-specific visual directions for image generation
 */
const STYLE_DIRECTIONS: Record<string, string> = {
  modern:
    'sleek modern design with gradient backgrounds, glass morphism effects, and tech-forward aesthetics',
  minimal:
    'clean minimalist design with lots of white space, subtle shadows, and elegant simplicity',
  corporate:
    'professional corporate style with blue tones, structured layouts, and business-appropriate imagery',
  creative: 'vibrant creative design with bold colors, dynamic compositions, and artistic flair',
};

/**
 * Generate a contextually relevant image prompt using GPT-4o-mini
 * This creates much better, topic-specific prompts than generic templates
 */
async function generateImagePrompt(slide: SlideContent, style: string): Promise<string> {
  const client = getOpenAIClient();
  const styleDirection = STYLE_DIRECTIONS[style] || STYLE_DIRECTIONS.modern;

  const systemPrompt = `You are an expert at creating image generation prompts for FLUX AI.
Your task is to create a single, detailed prompt for a presentation slide background image.

CRITICAL RULES:
- NO TEXT, WORDS, LETTERS, or NUMBERS in the image - FLUX cannot render text well
- Focus on visual metaphors, abstract representations, and relevant imagery
- The image will be used as a BACKGROUND, so avoid cluttered compositions
- Include specific visual elements that relate to the topic
- Specify colors, lighting, composition, and mood
- Keep the prompt under 150 words

Style direction: ${styleDirection}`;

  const userPrompt = `Create an image prompt for a slide about: "${slide.title}"

Key points covered:
${slide.bulletPoints.map((p) => `- ${p}`).join('\n')}

${slide.visualDescription ? `Visual hint: ${slide.visualDescription}` : ''}

Generate a detailed, specific prompt for FLUX that creates a relevant, professional background image. Remember: NO TEXT in the image.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini', // Cheapest model, ~$0.00015 per 1K input tokens
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const generatedPrompt = response.choices[0]?.message?.content?.trim();

    if (!generatedPrompt) {
      throw new Error('Empty response from GPT');
    }

    serviceLogger.info('Generated GPT image prompt', {
      slideNumber: slide.slideNumber,
      promptPreview: `${generatedPrompt.substring(0, 100)}...`,
    });

    return generatedPrompt;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.warn('Failed to generate custom prompt, using fallback', {
      slideNumber: slide.slideNumber,
      error: errorMessage,
    });

    // Fallback to a basic but topic-relevant prompt
    return `Professional presentation background for ${slide.title}. ${styleDirection}. Abstract visual representation, no text, high quality, 4K resolution.`;
  }
}

/**
 * Generate a single slide image using FLUX with GPT-enhanced prompts
 */
export async function generateSlideImage(
  slide: SlideContent,
  options: {
    model?: keyof typeof FLUX_MODELS;
    aspectRatio?: '16:9' | '4:3' | '1:1';
    style?: 'modern' | 'minimal' | 'corporate' | 'creative';
  } = {}
): Promise<string> {
  const { model = 'schnell', aspectRatio = '16:9', style = 'modern' } = options;

  await initializeFalClient();

  // Generate a contextually relevant prompt using GPT-4o-mini
  const prompt = await generateImagePrompt(slide, style);

  serviceLogger.info('Generating slide image', {
    slideNumber: slide.slideNumber,
    title: slide.title,
    model,
    promptPreview: `${prompt.substring(0, 80)}...`,
  });

  try {
    const result = await fal.subscribe(FLUX_MODELS[model], {
      input: {
        prompt,
        image_size:
          aspectRatio === '16:9'
            ? 'landscape_16_9'
            : aspectRatio === '4:3'
              ? 'landscape_4_3'
              : 'square',
        num_images: 1,
        enable_safety_checker: true,
      },
      logs: true,
    });

    interface FluxOutput {
      images?: Array<{ url?: string }>;
    }
    const imageUrl = (result.data as FluxOutput)?.images?.[0]?.url;

    if (!imageUrl) {
      throw new Error('No image URL in response');
    }

    serviceLogger.info('Slide image generated', {
      slideNumber: slide.slideNumber,
      imageUrl: `${imageUrl.substring(0, 50)}...`,
    });

    return imageUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.error('Failed to generate slide image', {
      slideNumber: slide.slideNumber,
      error: errorMessage,
    });
    throw new ExternalServiceError('Fal AI', `Image generation failed: ${errorMessage}`);
  }
}

/**
 * Generate multiple slide images in parallel
 */
export async function generateSlideImages(
  slides: SlideContent[],
  options: {
    model?: keyof typeof FLUX_MODELS;
    aspectRatio?: '16:9' | '4:3' | '1:1';
    style?: 'modern' | 'minimal' | 'corporate' | 'creative';
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<GeneratedSlide[]> {
  const { onProgress } = options;
  const results: GeneratedSlide[] = [];
  let completed = 0;

  serviceLogger.info('Generating slide images', { count: slides.length });

  // Generate images sequentially to avoid rate limits
  for (const slide of slides) {
    try {
      const imageUrl = await generateSlideImage(slide, options);
      results.push({
        slideNumber: slide.slideNumber,
        imageUrl,
        title: slide.title,
        content: slide.bulletPoints,
      });
    } catch (error) {
      serviceLogger.warn('Failed to generate slide, using placeholder', {
        slideNumber: slide.slideNumber,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      // Continue with other slides even if one fails
    }

    completed++;
    onProgress?.(completed, slides.length);
  }

  return results;
}

/**
 * Extract slide content from document text using OpenAI
 */
export async function extractSlidesFromContent(
  content: string,
  options: {
    maxSlides?: number;
    targetDuration?: number; // seconds per slide
  } = {}
): Promise<SlideContent[]> {
  const { maxSlides = 10 } = options;

  // This will be called from the slideshow service which uses OpenAI
  // For now, return a simple extraction
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 50);
  const slides: SlideContent[] = [];

  // Create title slide
  slides.push({
    slideNumber: 1,
    title: 'Course Overview',
    bulletPoints: ['Welcome to this course module'],
    visualDescription: 'Professional title slide with abstract educational graphics',
  });

  // Create content slides from paragraphs
  for (let i = 0; i < Math.min(paragraphs.length, maxSlides - 2); i++) {
    const paragraph = paragraphs[i];
    const sentences = paragraph.split(/[.!?]+/).filter((s) => s.trim().length > 10);

    slides.push({
      slideNumber: slides.length + 1,
      title: `Key Point ${i + 1}`,
      bulletPoints: sentences.slice(0, 4).map((s) => s.trim()),
      visualDescription: `Visual representation of: ${sentences[0]?.substring(0, 100) || 'educational content'}`,
    });
  }

  // Create conclusion slide
  slides.push({
    slideNumber: slides.length + 1,
    title: 'Summary',
    bulletPoints: ['Key takeaways from this module'],
    visualDescription: 'Professional conclusion slide with summary graphics',
  });

  return slides;
}
