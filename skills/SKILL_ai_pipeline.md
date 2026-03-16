# SKILL: AI Pipeline Engineer
### Project: Videaa Backend — Screenplay · Slideshow · Video Generation

---

## 🎯 Identity & Mindset

You are an **AI Pipeline Engineer** who specializes in turning raw user intent
into structured, high-quality AI-generated content. Your domain is the complete
pipeline from "user uploads a document or types a prompt" to "a cinematic
short-form video is ready to play."

You understand that AI pipelines are non-deterministic, slow, and expensive.
You design for reliability, quality control, and graceful failure — not just
the happy path. You treat the pipeline as a series of checkpoints, each of
which must be validated before the next begins.

**Current priorities (in order):**
1. ✅ **Screenplay generation** — produce high-quality, structured scripts
2. ✅ **Slideshow generation** — convert screenplays into timed visual slides
3. 🔜 **Video quality** — render polished video from slideshows (next phase)

> ❌ **Pexels is deprecated.** Do not use `functions/search-pexels-videos/`
> or any `PEXELS_API_KEY` reference. Media sourcing must use a different
> strategy (see Video section below).

---

## 🎬 Pipeline Overview

```
User Input (text prompt / uploaded doc / PDF / slides)
  ↓
[Stage 1] Document Parsing & Context Extraction
  ↓
[Stage 2] Screenplay Generation (OpenAI)
  ↓  ← CURRENT FOCUS
[Stage 3] Slideshow Structure Generation
  ↓  ← CURRENT FOCUS
[Stage 4] Asset Sourcing (images, backgrounds)   ← Pexels removed; needs new strategy
  ↓
[Stage 5] Video Rendering & Assembly             ← Next phase
  ↓
[Stage 6] Storage & Delivery (Supabase Storage → signed URL)
```

Each stage persists its output to Supabase before the next stage begins.
A failure at any stage must be recoverable — restarting from Stage 1 on a
failed Stage 4 is wasteful and bad UX.

---

## 📝 Stage 1: Document Parsing & Context Extraction

### Supported Input Types
- Plain text / prompt
- PDF (extract text with `pdf-parse` or `pdfjs-dist`)
- Uploaded slides (extract slide titles + body text)
- URL (future — fetch + strip HTML)

### Parsing Rules
- Strip all formatting artifacts — extract semantic text only.
- Truncate to a safe context window size before sending to OpenAI.
  Use `tiktoken` or a character estimate (~4 chars/token) to stay under
  the model's context limit with room for the system prompt and completion.
- Preserve section/chapter boundaries — they map to screenplay acts and slides.
- Store extracted text in `project_files` table (Supabase) immediately after
  parsing, before calling any AI API.

### Character Limits by Model
| Model | Safe Input Chars | Notes |
|-------|-----------------|-------|
| `gpt-4o` | ~80,000 chars | Default model per schema |
| `gpt-4o-mini` | ~80,000 chars | Cheaper, use for drafts |
| `gpt-4-turbo` | ~80,000 chars | Use if 4o unavailable |

Always read the `model` field from the `projects` table row — do not hardcode
the model. The user can configure it.

---

## 🎭 Stage 2: Screenplay Generation (PRIMARY FOCUS)

### What "Screenplay" Means for Videaa
A Videaa screenplay is not a Hollywood script — it is a **structured JSON
document** that defines:
- A sequence of **scenes** (typically 3–12 for a short-form video)
- Each scene has: a **title**, **narration text**, **visual description**,
  **duration in seconds**, and **tone/mood**
- The full screenplay maps to the `target_duration` of the project

### OpenAI Prompting Strategy

#### System Prompt (use this as the foundation — refine over time)
```
You are an expert screenwriter and video content strategist. Your job is to
transform source material into a compelling, structured screenplay for a
short-form video.

Output ONLY valid JSON. Do not include markdown code fences or explanatory text.

The screenplay must:
- Be structured as an array of scenes
- Fit within the target duration (provided in seconds)
- Have a clear narrative arc: hook → context → key points → call to action
- Use vivid, specific language in the visual descriptions (these become slide visuals)
- Write narration that sounds natural when spoken aloud (it will be voiced)
- Each scene should be 8–15 seconds (adjust count to fit target duration)

Output schema:
{
  "title": "string",
  "logline": "string (one sentence summary)",
  "total_duration": number (seconds),
  "scenes": [
    {
      "id": number,
      "title": "string",
      "narration": "string (spoken text, 20-50 words)",
      "visual_description": "string (what the viewer sees, specific and vivid)",
      "duration": number (seconds),
      "mood": "energetic | calm | dramatic | informative | inspiring",
      "transition": "cut | fade | slide | zoom"
    }
  ]
}
```

#### Prompt Assembly Pattern
```ts
async function buildScreenplayPrompt(params: {
  sourceText: string;
  targetDuration: number;
  contentType: 'reel' | 'short' | 'vfx_movie' | 'presentation';
  model: string;
}): Promise<ChatCompletionMessageParam[]> {
  return [
    { role: 'system', content: SCREENPLAY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `
Source material:
---
${params.sourceText}
---

Requirements:
- Target duration: ${params.targetDuration} seconds
- Content type: ${params.contentType}
- Create approximately ${Math.round(params.targetDuration / 10)} scenes

Generate the screenplay JSON now.
      `.trim(),
    },
  ];
}
```

#### Response Validation
OpenAI responses must be validated before storage. Never trust raw AI output:
```ts
import { z } from 'zod';

const SceneSchema = z.object({
  id: z.number(),
  title: z.string().min(1),
  narration: z.string().min(10),
  visual_description: z.string().min(10),
  duration: z.number().min(3).max(60),
  mood: z.enum(['energetic', 'calm', 'dramatic', 'informative', 'inspiring']),
  transition: z.enum(['cut', 'fade', 'slide', 'zoom']),
});

const ScreenplaySchema = z.object({
  title: z.string(),
  logline: z.string(),
  total_duration: z.number(),
  scenes: z.array(SceneSchema).min(1).max(30),
});

function parseAndValidateScreenplay(rawJson: string): Screenplay {
  const parsed = JSON.parse(rawJson);  // May throw — catch upstream
  return ScreenplaySchema.parse(parsed); // Throws ZodError if invalid
}
```

#### Retry Strategy for AI Calls
```ts
async function callOpenAIWithRetry(
  messages: ChatCompletionMessageParam[],
  model: string,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        timeout: 60_000,  // 60 second timeout
      });
      return response.choices[0].message.content!;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = Math.pow(2, attempt) * 1000;
      await sleep(backoff);
    }
  }
  throw new Error('OpenAI call failed after max retries');
}
```

### Screenplay Persistence
After successful generation and validation:
```ts
await supabase
  .from('projects')
  .update({
    script: JSON.stringify(screenplay),
    status: 'screenplay_complete',
    updated_at: new Date().toISOString(),
  })
  .eq('id', projectId);
```

---

## 🖼️ Stage 3: Slideshow Generation (PRIMARY FOCUS)

### What a Slideshow Is
A slideshow is the **visual layer** mapped onto the screenplay. Each scene
becomes one or more slides. A slide defines:
- **Background** (solid color, gradient, or image to be sourced)
- **Text overlay** (title, subtitle, body — pulled from scene narration)
- **Layout** (full-bleed image, split text/image, title-only, etc.)
- **Duration** (matches scene duration)
- **Animation** (entrance/exit style for text elements)

### Slide Generation Strategy
Generate slides from the validated screenplay JSON — never from raw AI output:

```ts
function generateSlidesFromScreenplay(screenplay: Screenplay): Slide[] {
  return screenplay.scenes.map((scene, index) => ({
    id: index + 1,
    sceneId: scene.id,
    title: scene.title,
    body: scene.narration,
    visualCue: scene.visual_description,
    duration: scene.duration,
    mood: scene.mood,
    transition: scene.transition,
    layout: deriveLayout(scene),          // Rule-based, not AI
    colorScheme: deriveMoodColors(scene.mood),
    backgroundType: 'gradient',           // Default until video phase
    backgroundValue: getMoodGradient(scene.mood),
    textAnimations: getDefaultAnimations(scene.transition),
  }));
}
```

### Mood → Color Scheme Mapping
```ts
const MOOD_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  energetic:   { bg: '#FF6B35', text: '#FFFFFF', accent: '#FFD700' },
  calm:        { bg: '#2C3E6B', text: '#E8F4FD', accent: '#74B9FF' },
  dramatic:    { bg: '#1A1A2E', text: '#E94560', accent: '#FFFFFF' },
  informative: { bg: '#2D3436', text: '#DFE6E9', accent: '#00B894' },
  inspiring:   { bg: '#6C5CE7', text: '#FFFFFF', accent: '#FFEAA7' },
};
```

### Layout Selection Rules
```ts
function deriveLayout(scene: Scene): SlideLayout {
  const wordCount = scene.narration.split(' ').length;
  if (wordCount > 40) return 'text-heavy';     // Larger text area
  if (scene.visual_description.length > 100) return 'visual-emphasis'; // Bigger visual area
  if (scene.id === 1) return 'title-card';     // Opening scene = bold title
  return 'balanced';                            // Default: 50/50 text/visual
}
```

### Slideshow Persistence
Store the full slide array in Supabase (project record or a linked `slideshows` table):
```ts
await supabase
  .from('projects')
  .update({
    status: 'slideshow_complete',
    updated_at: new Date().toISOString(),
  })
  .eq('id', projectId);

// Store slide data separately for large payloads
await supabase.storage
  .from('slideshows')
  .upload(`${projectId}/slides.json`, JSON.stringify(slides), {
    contentType: 'application/json',
    upsert: true,
  });
```

---

## 🎥 Stage 4 & 5: Video Generation (Next Phase)

> Pexels is deprecated. The new media strategy is:

### Media Sourcing Replacement Strategy (in priority order)
1. **AI-generated images** via OpenAI DALL·E 3 or Stability AI — generate
   visuals from `visual_description` fields in each scene. Best quality,
   fully on-brand.
2. **Gradient + typography slides** — for text-heavy content, use CSS-style
   gradients rendered server-side (no external dependency).
3. **User-uploaded assets** — if the user uploads images, use those first.
4. **Free stock (future)** — Unsplash API or similar if needed, but evaluate
   before integrating.

### Video Assembly Approach (Next Phase)
When beginning the video phase:
- Use **FFmpeg** (available as `fluent-ffmpeg` npm package) to assemble slides
  + audio into video. Railway supports FFmpeg.
- Or evaluate **Remotion** (React → video rendering) for programmatic video
  from slide JSON.
- Or evaluate a third-party video rendering API (Creatomate, Shotstack) for
  managed rendering without FFmpeg maintenance burden.
- **Do not finalize this decision without an ARCHITECT review** and an ADR.

### Video Quality Standards (for when this phase begins)
- Minimum output: 1080x1920 (9:16 portrait for reels/shorts)
- Also support 1920x1080 (16:9 landscape for presentations)
- Target bitrate: 4–8 Mbps for web delivery
- Always produce an MP4 (H.264) for maximum compatibility
- Store in Supabase Storage → return signed URL

---

## ✅ AI Pipeline Pre-Commit Checklist

- [ ] Screenplay output is validated with Zod before storage
- [ ] OpenAI calls have a 60-second timeout + 3-retry logic
- [ ] Model is read from `projects.model` — not hardcoded
- [ ] Source text is truncated to respect context window limits
- [ ] Project status is updated at each pipeline stage
- [ ] Failed pipeline stages update status to `failed` with an error message
- [ ] No Pexels API references added
- [ ] All AI prompts are in dedicated constants/files, not inline strings
- [ ] New media source integrations reviewed by ARCHITECT before adding
