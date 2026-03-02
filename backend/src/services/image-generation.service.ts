/**
 * Image Generation Service
 *
 * Generates images using fal.ai FLUX. Image prompts are created by OpenAI (GPT-4o-mini)
 * or Kimi (Moonshot) for better, topic-coherent prompts when using Kimi for slides.
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

const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = 'kimi-k2.5';

let fal: typeof import('@fal-ai/client').fal;
let openaiClient: OpenAI | null = null;
let kimiClient: OpenAI | null = null;

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

function getKimiClient(): OpenAI {
  if (!kimiClient) {
    const apiKey = process.env['MOONSHOT_API_KEY'];
    if (!apiKey) {
      throw new ServiceUnavailableError('Moonshot/Kimi', 'MOONSHOT_API_KEY is not set');
    }
    kimiClient = new OpenAI({ apiKey, baseURL: MOONSHOT_BASE_URL });
  }
  return kimiClient;
}

export function isKimiConfigured(): boolean {
  return !!process.env['MOONSHOT_API_KEY'];
}

/** Extract plain text from API message content (string or array of parts) */
function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part && typeof part === 'object' && 'text' in part ? String(part.text) : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
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

/**
 * Call at server startup to load @fal-ai/client so the dynamic import runs when the
 * process is stable. Avoids "Channel closed" when ts-node-dev restarts mid-request.
 */
export async function preloadFalClient(): Promise<void> {
  if (!isFalConfigured()) {
    return;
  }
  try {
    await initializeFalClient();
  } catch (err) {
    serviceLogger.warn('Fal client preload failed (will retry on first use)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
 * Generate a contextually relevant image prompt for FLUX using OpenAI or Kimi.
 * Kimi produces more coherent, topic-specific prompts when used for the whole slideshow.
 */
async function generateImagePrompt(
  slide: SlideContent,
  style: string,
  options: { promptProvider?: 'openai' | 'kimi' } = {}
): Promise<string> {
  const useKimi = options.promptProvider === 'kimi' && isKimiConfigured();
  const client = useKimi ? getKimiClient() : getOpenAIClient();
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

  const userPrompt = useKimi
    ? `Slide: "${slide.title}". Points: ${slide.bulletPoints.join('; ')}. ${slide.visualDescription ? `Visual: ${slide.visualDescription}` : ''}\n\nReply with ONLY the image prompt for FLUX (one paragraph, no quotes, no explanation). No text or words in the image. Style: ${styleDirection}.`
    : `Create an image prompt for a slide about: "${slide.title}"

Key points covered:
${slide.bulletPoints.map((p) => `- ${p}`).join('\n')}

${slide.visualDescription ? `Visual hint: ${slide.visualDescription}` : ''}

Generate a detailed, specific prompt for FLUX that creates a relevant, professional background image. Remember: NO TEXT in the image.`;

  try {
    const response = await client.chat.completions.create({
      model: useKimi ? KIMI_MODEL : 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: useKimi ? 1 : 0.8,
      max_tokens: useKimi ? 500 : 300,
    });

    const rawContent = response.choices[0]?.message?.content;
    const generatedPrompt = extractTextFromMessageContent(rawContent).trim();

    if (!generatedPrompt) {
      serviceLogger.warn('Empty content from image-prompt AI', {
        slideNumber: slide.slideNumber,
        promptProvider: useKimi ? 'kimi' : 'openai',
        finishReason: response.choices[0]?.finish_reason,
        rawType: typeof rawContent,
      });
      throw new Error('Empty response from content AI');
    }

    serviceLogger.info('Generated image prompt', {
      slideNumber: slide.slideNumber,
      promptProvider: useKimi ? 'kimi' : 'openai',
      promptPreview: `${generatedPrompt.substring(0, 100)}...`,
    });

    return generatedPrompt;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.warn('Failed to generate custom prompt, using fallback', {
      slideNumber: slide.slideNumber,
      promptProvider: useKimi ? 'kimi' : 'openai',
      error: errorMessage,
    });

    return `Professional presentation background for ${slide.title}. ${styleDirection}. Abstract visual representation, no text, high quality, 4K resolution.`;
  }
}

/**
 * Generate a single slide image using FLUX with AI-enhanced prompts (OpenAI or Kimi)
 */
export async function generateSlideImage(
  slide: SlideContent,
  options: {
    model?: keyof typeof FLUX_MODELS;
    aspectRatio?: '16:9' | '4:3' | '1:1';
    style?: 'modern' | 'minimal' | 'corporate' | 'creative';
    /** Use Kimi for the image prompt when true and MOONSHOT_API_KEY is set */
    promptProvider?: 'openai' | 'kimi';
  } = {}
): Promise<string> {
  const {
    model = 'schnell',
    aspectRatio = '16:9',
    style = 'modern',
    promptProvider = 'openai',
  } = options;

  await initializeFalClient();

  const prompt = await generateImagePrompt(slide, style, { promptProvider });

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
    /** Use Kimi for image prompts when 'kimi' (and MOONSHOT_API_KEY set) */
    promptProvider?: 'openai' | 'kimi';
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<GeneratedSlide[]> {
  const { onProgress, promptProvider = 'openai' } = options;
  const results: GeneratedSlide[] = [];
  let completed = 0;

  serviceLogger.info('Generating slide images', {
    count: slides.length,
    promptProvider: promptProvider === 'kimi' && isKimiConfigured() ? 'kimi' : 'openai',
  });

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
