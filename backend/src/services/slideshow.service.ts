/**
 * Slideshow Service
 *
 * Creates professional slideshow videos from document content.
 * Uses OpenAI or Kimi (Moonshot) to extract key points, FLUX for images.
 */

import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import * as imageService from './image-generation.service';
import * as storageService from './storage.service';
import { getEnv } from '@/config/env';
import { ExternalServiceError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const serviceLogger = logger.child({ service: 'slideshow' });

const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = 'kimi-k2.5';

let openaiClient: OpenAI | null = null;
let kimiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const env = getEnv();
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function getKimiClient(): OpenAI {
  if (!kimiClient) {
    const env = getEnv();
    const key = env.MOONSHOT_API_KEY;
    if (!key) {
      throw new ExternalServiceError('Moonshot/Kimi', 'MOONSHOT_API_KEY is not set.');
    }
    kimiClient = new OpenAI({ apiKey: key, baseURL: MOONSHOT_BASE_URL });
  }
  return kimiClient;
}

export function isKimiConfigured(): boolean {
  return !!process.env['MOONSHOT_API_KEY'];
}

/** Extract plain text from chat message content (string or array of parts) */
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

export interface SlideshowRequest {
  content: string;
  title?: string;
  maxSlides?: number;
  slideDuration?: number;
  style?: 'modern' | 'minimal' | 'corporate' | 'creative';
  aspectRatio?: '16:9' | '4:3';
  contentAiModel?: 'openai' | 'kimi';
  userId?: string;
}

export interface SlideData {
  slideNumber: number;
  title: string;
  bulletPoints: string[];
  narration: string;
  visualDescription: string;
  imageUrl?: string;
}

export interface SlideshowResult {
  success: boolean;
  slides: SlideData[];
  videoUrl?: string;
  totalDuration?: number;
  error?: string;
}

/**
 * Extract structured slides from document content using OpenAI or Kimi
 */
export async function extractSlides(
  content: string,
  options: {
    title?: string;
    maxSlides?: number;
    targetAudience?: string;
    contentAiModel?: 'openai' | 'kimi';
  } = {}
): Promise<SlideData[]> {
  const { title, maxSlides = 8, contentAiModel = 'openai' } = options;
  const isShortTopic = content.length < 100;
  const useKimi = contentAiModel === 'kimi' && isKimiConfigured();
  const provider = useKimi ? 'kimi' : 'openai';

  serviceLogger.info('Extracting slides from content', {
    contentLength: content.length,
    maxSlides,
    isShortTopic,
    provider,
  });

  if (content.length < 400) {
    serviceLogger.warn(
      'Content is very short; slides may be generic. For document-relevant slides, send the full extracted document text in the "content" field (not just a topic or title).'
    );
  }

  const client = useKimi ? getKimiClient() : getOpenAIClient();

  // Different prompts for short topics vs full content
  const systemPrompt = isShortTopic
    ? `You are an expert instructional designer creating educational presentation slides.
Given a topic name, create a comprehensive, educational slideshow about that topic.

Rules:
- Create exactly ${maxSlides} slides (including intro and summary)
- Research and include accurate, valuable information about the topic
- Each slide should have 3-4 bullet points maximum
- Bullet points should be concise (under 12 words each)
- Include a narration script for each slide (2-3 sentences, educational tone)
- Include a DETAILED visual description for each slide that is SPECIFIC to the topic
- Visual descriptions must describe concrete imagery related to the topic (e.g., for AWS: cloud servers, data centers, network diagrams; for cooking: kitchen scenes, ingredients, cooking tools)
- NO generic descriptions - make visuals topic-specific

Respond with valid JSON only.`
    : `You are an expert instructional designer creating presentation slides from educational content.
Your task is to extract key information and structure it into clear, engaging slides.

Rules:
- Create ${maxSlides} slides maximum (including title and summary slides)
- Each slide should have 3-5 bullet points maximum
- Bullet points should be concise (under 15 words each)
- Include a narration script for each slide (what a presenter would say)
- Include a DETAILED visual description for each slide that is SPECIFIC to the content
- Visual descriptions must describe concrete imagery related to the topic - NO generic "abstract shapes"
- NO text, words, or letters in visual descriptions

Respond with valid JSON only.`;

  const userPrompt = isShortTopic
    ? `Create an educational slideshow presentation about: "${content}"

${title ? `Presentation title: ${title}` : ''}

Generate ${maxSlides} informative slides covering key concepts, terminology, best practices, and practical applications of this topic.

Return JSON in this exact format:
{
  "slides": [
    {
      "slideNumber": 1,
      "title": "Slide Title",
      "bulletPoints": ["Point 1", "Point 2", "Point 3"],
      "narration": "What the presenter would say for this slide...",
      "visualDescription": "Detailed, topic-specific visual description (e.g., 'A modern data center with rows of servers, blue LED lights, and network cables connecting cloud infrastructure')"
    }
  ]
}`
    : `Create a slideshow presentation from this content:

Title: ${title || 'Course Module'}

Content:
${content.substring(0, 8000)}

Return JSON in this exact format:
{
  "slides": [
    {
      "slideNumber": 1,
      "title": "Slide Title",
      "bulletPoints": ["Point 1", "Point 2", "Point 3"],
      "narration": "What the presenter would say for this slide...",
      "visualDescription": "Detailed, topic-specific visual description (NO generic shapes - describe actual relevant imagery)"
    }
  ]
}`;

  try {
    const response = await client.chat.completions.create({
      model: useKimi ? KIMI_MODEL : 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: useKimi ? 1 : 0.6,
      max_tokens: useKimi ? 8192 : 4000,
      ...(useKimi ? {} : { response_format: { type: 'json_object' as const } }),
    });

    const rawContent = response.choices[0]?.message?.content;
    const responseContent = extractTextFromMessageContent(rawContent);
    if (!responseContent.trim()) {
      serviceLogger.warn('Empty slide-extraction response', {
        provider,
        finishReason: response.choices[0]?.finish_reason,
        rawType: typeof rawContent,
      });
      throw new Error('Empty response from content AI');
    }

    let raw = responseContent.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      raw = jsonMatch[0];
    }
    const parsed = JSON.parse(raw);
    const slides: SlideData[] = Array.isArray(parsed.slides) ? parsed.slides : [];

    serviceLogger.info('Slides extracted', { count: slides.length, provider });

    return slides;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.error('Failed to extract slides', { error: errorMessage });
    throw new ExternalServiceError(
      useKimi ? 'Kimi' : 'OpenAI',
      `Slide extraction failed: ${errorMessage}`
    );
  }
}

/**
 * Generate a complete slideshow with images
 */
export async function generateSlideshow(
  request: SlideshowRequest,
  onProgress?: (stage: string, progress: number) => void
): Promise<SlideshowResult> {
  const {
    content,
    title,
    maxSlides = 8,
    slideDuration = 5,
    style = 'modern',
    aspectRatio = '16:9',
    contentAiModel,
    userId,
  } = request;

  const effectiveContentAi = contentAiModel ?? (isKimiConfigured() ? 'kimi' : 'openai');

  serviceLogger.info('Starting slideshow generation', {
    contentLength: content.length,
    maxSlides,
    style,
    contentAiModel: effectiveContentAi,
  });

  try {
    // Step 1: Extract slides (Kimi or OpenAI)
    onProgress?.('Analyzing content and creating slides...', 10);
    const slides = await extractSlides(content, {
      title,
      maxSlides,
      contentAiModel: effectiveContentAi,
    });

    if (slides.length === 0) {
      return {
        success: false,
        slides: [],
        error: 'Could not extract any slides from the content',
      };
    }

    // Step 2: Generate images for each slide
    onProgress?.('Generating slide visuals...', 30);

    const slideContents: imageService.SlideContent[] = slides.map((slide) => ({
      slideNumber: slide.slideNumber,
      title: slide.title,
      bulletPoints: slide.bulletPoints,
      visualDescription: slide.visualDescription,
    }));

    const generatedImages = await imageService.generateSlideImages(slideContents, {
      model: 'schnell',
      aspectRatio: aspectRatio as '16:9' | '4:3',
      style,
      promptProvider: effectiveContentAi, // Kimi for both extraction and image prompts when Content AI is Kimi
      onProgress: (completed, total) => {
        const progress = 30 + (completed / total) * 50;
        onProgress?.(`Generating slide ${completed}/${total}...`, progress);
      },
    });

    // Merge image URLs back into slides
    for (const generated of generatedImages) {
      const slide = slides.find((s) => s.slideNumber === generated.slideNumber);
      if (slide) {
        slide.imageUrl = generated.imageUrl;
      }
    }

    // Step 3: Save images to Supabase Storage for persistence
    onProgress?.('Saving slides...', 85);

    for (const slide of slides) {
      if (slide.imageUrl && slide.imageUrl.includes('fal.media')) {
        try {
          const { storageUrl } = await storageService.saveImageFromUrl(slide.imageUrl, {
            userId,
            folder: 'slideshow-images',
            filename: `slide-${slide.slideNumber}-${randomUUID()}.jpg`,
          });
          slide.imageUrl = storageUrl;
        } catch (error) {
          serviceLogger.warn('Failed to save slide image to storage', {
            slideNumber: slide.slideNumber,
          });
        }
      }
    }

    onProgress?.('Slideshow complete!', 100);

    const totalDuration = slides.length * slideDuration;

    serviceLogger.info('Slideshow generation complete', {
      slideCount: slides.length,
      totalDuration,
    });

    return {
      success: true,
      slides,
      totalDuration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serviceLogger.error('Slideshow generation failed', { error: errorMessage });

    return {
      success: false,
      slides: [],
      error: errorMessage,
    };
  }
}

/**
 * Generate a quick preview slideshow (fewer slides, faster)
 */
export async function generatePreviewSlideshow(
  content: string,
  options: {
    userId?: string;
    style?: 'modern' | 'minimal' | 'corporate' | 'creative';
  } = {}
): Promise<SlideshowResult> {
  return generateSlideshow({
    content,
    maxSlides: 4, // Quick preview with fewer slides
    slideDuration: 3,
    style: options.style || 'modern',
    userId: options.userId,
  });
}
