-- Migration: Chat Messages and Screenplay Versioning
-- Created: 2026-02-20
-- Description: Adds tables for chat message persistence and screenplay version tracking

-- =============================================================================
-- Chat Messages Table
-- Stores chat history for ideation and project refinement
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  screenplay_version INT DEFAULT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_user ON chat_messages(project_id, user_id);

-- =============================================================================
-- Screenplay Versions Table
-- Tracks revision history for screenplays
-- =============================================================================

CREATE TABLE IF NOT EXISTS screenplay_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INT NOT NULL,
  screenplay JSONB NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, version)
);

-- Index for version lookups
CREATE INDEX IF NOT EXISTS idx_screenplay_versions_project ON screenplay_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_screenplay_versions_project_version ON screenplay_versions(project_id, version DESC);

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

-- Enable RLS on chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can view their own messages
CREATE POLICY "Users can view own messages" ON chat_messages
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own messages
CREATE POLICY "Users can insert own messages" ON chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can delete their own messages
CREATE POLICY "Users can delete own messages" ON chat_messages
  FOR DELETE USING (auth.uid() = user_id);

-- Enable RLS on screenplay_versions
ALTER TABLE screenplay_versions ENABLE ROW LEVEL SECURITY;

-- Users can view their own versions
CREATE POLICY "Users can view own versions" ON screenplay_versions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own versions
CREATE POLICY "Users can insert own versions" ON screenplay_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Service Role Access (for backend operations)
-- =============================================================================

-- Grant access to service role for both tables
GRANT ALL ON chat_messages TO service_role;
GRANT ALL ON screenplay_versions TO service_role;

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON TABLE chat_messages IS 'Stores chat messages for ideation and project refinement';
COMMENT ON COLUMN chat_messages.project_id IS 'Project this message belongs to (null for general ideation)';
COMMENT ON COLUMN chat_messages.role IS 'Message role: user, assistant, or system';
COMMENT ON COLUMN chat_messages.screenplay_version IS 'Associated screenplay version if applicable';
COMMENT ON COLUMN chat_messages.metadata IS 'Additional metadata (suggestions, etc.)';

COMMENT ON TABLE screenplay_versions IS 'Tracks screenplay revision history for each project';
COMMENT ON COLUMN screenplay_versions.version IS 'Version number (increments with each edit)';
COMMENT ON COLUMN screenplay_versions.screenplay IS 'Complete screenplay JSON at this version';
COMMENT ON COLUMN screenplay_versions.change_summary IS 'Summary of changes made in this version';
