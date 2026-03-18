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
  projectId?: string;
}

export interface SlideData {
  slideNumber: number;
  title: string;
  bulletPoints: string[];
  narration: string;
  /** Used for FLUX image generation; from extraction's imagePrompt or visualDescription */
  visualDescription: string;
  imageUrl?: string;
  /** Optional key fact/number (e.g. for badge) */
  keyStat?: string;
  /** Optional secondary line under title (e.g. date, source) */
  subtitle?: string;
}

export interface SlideshowResult {
  success: boolean;
  slides: SlideData[];
  videoUrl?: string;
  totalDuration?: number;
  error?: string;
}

/** Kimi slide-extraction prompt (see docs/BACKEND_SLIDESHOW_PROMPT.md). Placeholders: {{content}}, {{style}}, {{maxSlides}}, {{variant_id}} */
const KIMI_SLIDE_EXTRACTION_PROMPT = `You are an expert slideshow designer. Create a slide deck from the provided document text.

Output MUST be valid JSON only (no markdown, no commentary).

Inputs
Document text: {{content}}
Desired style: {{style}} (one of: modern, minimal, corporate, creative)
Deck size: {{maxSlides}} (integer)
Variant ID: {{variant_id}} (integer 1..5)
The variant ID must change the layout/text hierarchy strategy so different runs are meaningfully different even with the same style.

Hard Requirements (non-negotiable)
Do not use filler phrases like "Introduction", "Key takeaway", "Conclusion", "Overview", "In this presentation".
Every slide must contain document-derived statements (specific facts/claims/steps/metrics/phrasing grounded in the input).
No repeated wording patterns across slides. Avoid repeating the same title structure or bullet phrasing templates.
Bullet length: each bulletPoints[] item should be ~12–18 words max.
For image prompts: include imagePrompt and ensure the generated background is suitable for overlay text.
Explicitly instruct: NO TEXT in the image.
Leave clear negative space in the lower-middle and upper corner areas for badge/title/bullets overlay.
Avoid logos, watermarks, UI screenshots, and readable typography.

Style Rules
corporate: Formal tone. 2–3 bullets per slide. Title in Title Case. Conservative wording, fewer hype phrases.
minimal: 0–2 bullets per slide (prefer 1–2). Short phrases, more whitespace implied. Titles should be shorter than other styles.
modern: 3–4 bullets per slide. Action-oriented language. Clear hierarchy: title + contemporary concise bullets.
creative: 3–4 bullets per slide. More expressive but still professional. Titles can use metaphor/creative framing (but not childish).

Layout/Hierarchy Variety via variant_id
Use variant_id to change the deck's text hierarchy strategy:
variant_id 1: "Problem → Mechanism → Impact" style titles (varied).
variant_id 2: "Principles" style titles + bullets like constraints/actions.
variant_id 3: "Steps/Workflow" style titles + bullets as ordered actions.
variant_id 4: "Metrics/Outcomes" style titles + bullets as quantified claims.
variant_id 5: "Contrasts" style titles + bullets as before/after differences.
Every slide within the deck must reflect the chosen hierarchy strategy, but titles must still differ slide-to-slide.

Image Prompt Requirements
For each slide, output imagePrompt that matches: the overall style mood; the slide's topic (from title/bullets); safe composition for overlay text; NO TEXT; clear negative space for overlay.

Output JSON Schema (valid JSON only)
Return exactly:
{
  "slides": [
    {
      "slideNumber": 1,
      "title": "string",
      "bulletPoints": ["string", "..."],
      "narration": "string",
      "imagePrompt": "string",
      "keyStat": "optional string - one key fact/number from document",
      "subtitle": "optional string - e.g. date, source"
    }
  ]
}

Create exactly {{maxSlides}} slides. Enforce bullet count limits per style. Make titles and bullets vary meaningfully across slides and across variant_id. Now generate the deck.`;

/**
 * Normalize a raw slide from LLM (accept camelCase and snake_case, imagePrompt → visualDescription)
 */
function normalizeParsedSlide(raw: Record<string, unknown>): SlideData {
  const bulletPoints = Array.isArray(raw.bulletPoints) ? raw.bulletPoints.map(String) : [];
  const keyStat = raw.keyStat ?? raw.key_stat;
  const subtitle = raw.subtitle ?? raw.sub_title;
  const imagePrompt = raw.imagePrompt ?? raw.image_prompt;
  const visualDescription = raw.visualDescription ?? raw.visual_description;
  return {
    slideNumber: Number(raw.slideNumber ?? raw.slide_number ?? 0),
    title: String(raw.title ?? ''),
    bulletPoints,
    narration: String(raw.narration ?? ''),
    visualDescription:
      typeof imagePrompt === 'string' && imagePrompt.trim()
        ? imagePrompt
        : String(visualDescription ?? ''),
    keyStat: typeof keyStat === 'string' && keyStat.trim() ? keyStat : undefined,
    subtitle: typeof subtitle === 'string' && subtitle.trim() ? subtitle : undefined,
  };
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
    style?: 'modern' | 'minimal' | 'corporate' | 'creative';
    /** 1–5: changes layout/hierarchy strategy for variety (Kimi only) */
    variantId?: number;
  } = {}
): Promise<SlideData[]> {
  const { title, maxSlides = 8, contentAiModel = 'openai', style = 'modern', variantId } = options;
  const isShortTopic = content.length < 100;
  const useKimi = contentAiModel === 'kimi' && isKimiConfigured();
  const provider = useKimi ? 'kimi' : 'openai';
  const effectiveVariantId = Math.min(
    5,
    Math.max(1, variantId ?? Math.floor(Math.random() * 5) + 1)
  );

  serviceLogger.info('Extracting slides from content', {
    contentLength: content.length,
    maxSlides,
    isShortTopic,
    provider,
    ...(useKimi && { style, variantId: effectiveVariantId }),
  });

  if (content.length < 400) {
    serviceLogger.warn(
      'Content is very short; slides may be generic. For document-relevant slides, send the full extracted document text in the "content" field (not just a topic or title).'
    );
  }

  const client = useKimi ? getKimiClient() : getOpenAIClient();

  let systemPrompt: string;
  let userPrompt: string;

  if (useKimi) {
    const truncatedContent = content.substring(0, 24000);
    userPrompt = KIMI_SLIDE_EXTRACTION_PROMPT.replace(/\{\{content\}\}/g, truncatedContent)
      .replace(/\{\{style\}\}/g, style)
      .replace(/\{\{maxSlides\}\}/g, String(maxSlides))
      .replace(/\{\{variant_id\}\}/g, String(effectiveVariantId));
    systemPrompt = 'Output MUST be valid JSON only. No markdown code fences, no commentary.';
  } else {
    // OpenAI: keep existing behavior, with optional keyStat/subtitle in schema
    systemPrompt = isShortTopic
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
- Optional: include keyStat (one key fact/number) and subtitle (e.g. date, source) when relevant

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
- Optional: include keyStat (one key fact/number) and subtitle (e.g. date, source) when relevant

Respond with valid JSON only.`;

    userPrompt = isShortTopic
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
      "visualDescription": "Detailed, topic-specific visual description (e.g., 'A modern data center with rows of servers, blue LED lights, and network cables connecting cloud infrastructure')",
      "keyStat": "optional - one key fact or number",
      "subtitle": "optional - e.g. date or source"
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
      "visualDescription": "Detailed, topic-specific visual description (NO generic shapes - describe actual relevant imagery)",
      "keyStat": "optional - one key fact or number from document",
      "subtitle": "optional - e.g. date or source"
    }
  ]
}`;
  }

  try {
    const response = await client.chat.completions.create({
      model: useKimi ? KIMI_MODEL : 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: useKimi ? 1 : 0.6, // Kimi API only allows temperature 1 for this model
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
    const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
    const slides: SlideData[] = rawSlides.map((s: Record<string, unknown>) =>
      normalizeParsedSlide(s)
    );

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
      style,
      variantId: Math.floor(Math.random() * 5) + 1,
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
      // When using Kimi extraction, we already have a per-slide imagePrompt; pass it to avoid re-calling LLM
      preGeneratedImagePrompt:
        effectiveContentAi === 'kimi' && slide.visualDescription
          ? slide.visualDescription
          : undefined,
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
