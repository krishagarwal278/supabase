/**
 * Chat Service
 *
 * Handles AI ideation chat and message persistence for projects.
 */

import OpenAI from 'openai';
import { TABLES, OPENAI_CONFIG, getOpenAIModelName } from '@/config/constants';
import { getEnv } from '@/config/env';
import { getServiceClient } from '@/lib/database';
import { DatabaseError, ExternalServiceError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const chatLogger = logger.child({ service: 'chat' });

// Lazy-initialized OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const env = getEnv();
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
  id: string;
  projectId: string | null;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  screenplayVersion: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface IdeationResponse {
  response: string;
  suggestions: string[];
}

// =============================================================================
// AI Ideation
// =============================================================================

/**
 * Generate AI ideation response for brainstorming
 * @param message - User's message
 * @param context - Optional context including format, previous messages, and AI model preference
 */
export async function generateIdeation(
  message: string,
  context?: {
    format?: string;
    previousMessages?: Array<{ role: string; content: string }>;
    aiModel?: string;
    currentScreenplay?: Record<string, unknown>;
  }
): Promise<IdeationResponse> {
  const modelToUse = getOpenAIModelName(context?.aiModel || OPENAI_CONFIG.DEFAULT_MODEL);
  chatLogger.info('Generating ideation response', {
    messageLength: message.length,
    aiModel: modelToUse,
    hasScreenplay: !!context?.currentScreenplay,
  });

  let systemPrompt = `You are a creative video content strategist helping users brainstorm and plan their video content.

Your role is to:
- Help users refine their video ideas
- Suggest engaging angles and hooks
- Provide structure recommendations based on the video format
- Offer creative suggestions for visual storytelling
- Give tips for making content more engaging

${context?.format ? `The user is planning a ${context.format} video.` : ''}`;

  // If there's an existing screenplay, include it for context
  if (context?.currentScreenplay) {
    systemPrompt += `

CURRENT SCREENPLAY:
The user has a screenplay in progress. When they ask for changes or refinements, suggest specific modifications to the screenplay.
${JSON.stringify(context.currentScreenplay, null, 2)}

When the user requests changes to the screenplay, your suggestions should be specific scene modifications they can apply.`;
  }

  systemPrompt += `

Respond in a helpful, encouraging tone. Keep responses concise but actionable.
After your main response, provide 2-4 specific suggestions as a JSON array in this format at the end:
###SUGGESTIONS###
["suggestion 1", "suggestion 2", "suggestion 3"]`;

  try {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add previous context if available
    if (context?.previousMessages) {
      for (const msg of context.previousMessages.slice(-6)) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: message });

    const response = await getOpenAI().chat.completions.create({
      model: modelToUse,
      messages,
      temperature: 0.8,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || '';

    // Parse suggestions from response
    let mainResponse = content;
    let suggestions: string[] = [];

    const suggestionsMatch = content.match(/###SUGGESTIONS###\s*(\[[\s\S]*?\])/);
    if (suggestionsMatch) {
      mainResponse = content.replace(/###SUGGESTIONS###[\s\S]*$/, '').trim();
      try {
        suggestions = JSON.parse(suggestionsMatch[1]);
      } catch {
        suggestions = [];
      }
    }

    chatLogger.info('Ideation generated', { suggestionsCount: suggestions.length });

    return {
      response: mainResponse,
      suggestions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    chatLogger.error('Ideation generation failed', { error: message });
    throw new ExternalServiceError('OpenAI', `Ideation failed: ${message}`);
  }
}

// =============================================================================
// Chat Message Persistence
// =============================================================================

/**
 * Save a chat message
 */
export async function saveMessage(params: {
  projectId?: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  screenplayVersion?: number;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessage> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.CHAT_MESSAGES)
    .insert({
      project_id: params.projectId || null,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      screenplay_ver: params.screenplayVersion || null,
      metadata: params.metadata || {},
    })
    .select()
    .single();

  if (error) {
    throw new DatabaseError(`Failed to save message: ${error.message}`);
  }

  return formatMessage(data);
}

/**
 * Get chat messages for a project
 */
export async function getProjectMessages(
  projectId: string,
  userId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.CHAT_MESSAGES)
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new DatabaseError(`Failed to fetch messages: ${error.message}`);
  }

  return (data || []).map(formatMessage);
}

/**
 * Get recent ideation messages (without project)
 */
export async function getIdeationMessages(
  userId: string,
  limit: number = 20
): Promise<ChatMessage[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.CHAT_MESSAGES)
    .select('*')
    .eq('user_id', userId)
    .is('project_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DatabaseError(`Failed to fetch ideation messages: ${error.message}`);
  }

  return (data || []).map(formatMessage).reverse();
}

/**
 * Delete messages for a project
 */
export async function deleteProjectMessages(projectId: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase.from(TABLES.CHAT_MESSAGES).delete().eq('project_id', projectId);

  if (error) {
    chatLogger.warn('Failed to delete project messages', { projectId, error: error.message });
  }
}

// =============================================================================
// Project chat (full load/replace for GET/POST /api/v1/project/:projectId/chat)
// =============================================================================

export type ProjectChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string; // ISO 8601
};

/**
 * Get project chat messages in API shape (id, role, content, timestamp).
 * Caller must ensure project belongs to userId.
 */
export async function getProjectChat(
  projectId: string,
  userId: string
): Promise<ProjectChatMessage[]> {
  const messages = await getProjectMessages(projectId, userId, 500);
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.createdAt,
  }));
}

/**
 * Replace project chat with the provided messages (full replace).
 * Caller must ensure project belongs to userId.
 */
export async function replaceProjectChat(
  projectId: string,
  userId: string,
  messages: Array<{
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>
): Promise<ProjectChatMessage[]> {
  const supabase = getServiceClient();

  const { error: deleteError } = await supabase
    .from(TABLES.CHAT_MESSAGES)
    .delete()
    .eq('project_id', projectId);

  if (deleteError) {
    throw new DatabaseError(`Failed to clear project chat: ${deleteError.message}`);
  }

  if (messages.length === 0) {
    return [];
  }

  const rows = messages.map((m) => ({
    project_id: projectId,
    user_id: userId,
    role: m.role,
    content: m.content,
    screenplay_ver: null,
    metadata: {},
  }));

  const { data: inserted, error: insertError } = await supabase
    .from(TABLES.CHAT_MESSAGES)
    .insert(rows)
    .select('id, role, content, created_at');

  if (insertError) {
    throw new DatabaseError(`Failed to save project chat: ${insertError.message}`);
  }

  return (inserted || []).map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    timestamp: row.created_at,
  }));
}

// =============================================================================
// Screenplay Versioning
// =============================================================================

/**
 * Save a screenplay version
 */
export async function saveScreenplayVersion(params: {
  projectId: string;
  userId: string;
  screenplay: Record<string, unknown>;
  changeSummary?: string;
}): Promise<{ version: number }> {
  const supabase = getServiceClient();

  // Get current max version
  const { data: existing } = await supabase
    .from(TABLES.SCREENPLAY_VERSIONS)
    .select('version')
    .eq('project_id', params.projectId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const newVersion = (existing?.version || 0) + 1;

  const { error } = await supabase.from(TABLES.SCREENPLAY_VERSIONS).insert({
    project_id: params.projectId,
    user_id: params.userId,
    version: newVersion,
    screenplay: params.screenplay,
    change_summary: params.changeSummary || null,
  });

  if (error) {
    chatLogger.warn('Failed to save screenplay version', { error: error.message });
  }

  return { version: newVersion };
}

/**
 * Get all versions for a project
 */
export async function getScreenplayVersions(
  projectId: string
): Promise<Array<{ version: number; changeSummary: string | null; createdAt: string }>> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.SCREENPLAY_VERSIONS)
    .select('version, change_summary, created_at')
    .eq('project_id', projectId)
    .order('version', { ascending: false });

  if (error) {
    throw new DatabaseError(`Failed to fetch versions: ${error.message}`);
  }

  return (data || []).map((v) => ({
    version: v.version,
    changeSummary: v.change_summary,
    createdAt: v.created_at,
  }));
}

/**
 * Get a specific screenplay version
 */
export async function getScreenplayVersion(
  projectId: string,
  version: number
): Promise<{ screenplay: Record<string, unknown>; changeSummary: string | null } | null> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from(TABLES.SCREENPLAY_VERSIONS)
    .select('screenplay, change_summary')
    .eq('project_id', projectId)
    .eq('version', version)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new DatabaseError(`Failed to fetch version: ${error.message}`);
  }

  return {
    screenplay: data.screenplay,
    changeSummary: data.change_summary,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function formatMessage(data: Record<string, unknown>): ChatMessage {
  return {
    id: data.id as string,
    projectId: data.project_id as string | null,
    userId: data.user_id as string,
    role: data.role as 'user' | 'assistant' | 'system',
    content: data.content as string,
    screenplayVersion: data.screenplay_ver as number | null,
    metadata: (data.metadata as Record<string, unknown>) || {},
    createdAt: data.created_at as string,
  };
}
