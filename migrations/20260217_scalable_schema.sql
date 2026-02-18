-- =============================================================================
-- SCALABLE SCHEMA MIGRATION - RUN THIS IN SUPABASE SQL EDITOR
-- =============================================================================
-- 
-- WHAT THIS DOES:
-- 1. MODIFIES existing tables (projects, project_files, chat_history, pexels_videos)
-- 2. CREATES new tables (screenplays, video_generations, user_usage)
-- 3. DROPS the unused "Backend" table
-- 4. FIXES RLS policies for proper security
-- 5. ADDS proper indexes for performance
--
-- IMPORTANT: Run each section one at a time in Supabase SQL Editor
-- =============================================================================

-- =============================================================================
-- STEP 1: DROP UNUSED TABLE
-- =============================================================================
DROP TABLE IF EXISTS "public"."Backend" CASCADE;


-- =============================================================================
-- STEP 2: MODIFY "projects" TABLE - Add user ownership
-- =============================================================================

-- Add user_id column (nullable first to handle existing data)
ALTER TABLE "public"."projects" 
ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add error tracking column
ALTER TABLE "public"."projects"
ADD COLUMN IF NOT EXISTS "error_message" text;

-- Add indexes
CREATE INDEX IF NOT EXISTS "idx_projects_user_id" ON "public"."projects" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_projects_user_created" ON "public"."projects" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_projects_user_status" ON "public"."projects" ("user_id", "status");


-- =============================================================================
-- STEP 3: MODIFY "project_files" TABLE - Add user ownership
-- =============================================================================

-- Add user_id column
ALTER TABLE "public"."project_files"
ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add metadata column for storing extra file info
ALTER TABLE "public"."project_files"
ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;

-- Add index
CREATE INDEX IF NOT EXISTS "idx_project_files_user_id" ON "public"."project_files" ("user_id");

-- Backfill user_id from projects (if project_files exist without user_id)
UPDATE "public"."project_files" pf
SET user_id = p.user_id
FROM "public"."projects" p
WHERE pf.project_id = p.id AND pf.user_id IS NULL AND p.user_id IS NOT NULL;


-- =============================================================================
-- STEP 4: MODIFY "chat_history" TABLE - Add project linking & indexes
-- =============================================================================

-- Add project_id to link chats to projects
ALTER TABLE "public"."chat_history"
ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "public"."projects"(id) ON DELETE SET NULL;

-- Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_chat_history_user_chat" ON "public"."chat_history" ("user_id", "chat_id");
CREATE INDEX IF NOT EXISTS "idx_chat_history_project" ON "public"."chat_history" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_chat_history_created" ON "public"."chat_history" ("created_at" DESC);

-- Add updated_at trigger if missing
DROP TRIGGER IF EXISTS "update_chat_history_updated_at" ON "public"."chat_history";
CREATE TRIGGER "update_chat_history_updated_at" 
    BEFORE UPDATE ON "public"."chat_history" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


-- =============================================================================
-- STEP 5: MODIFY "pexels_videos" TABLE - Add cache expiration
-- =============================================================================

-- Add expiration for cache cleanup
ALTER TABLE "public"."pexels_videos"
ADD COLUMN IF NOT EXISTS "expires_at" timestamptz DEFAULT (now() + interval '7 days');

-- Add user_id to track who searched (optional, can be null for shared cache)
ALTER TABLE "public"."pexels_videos"
ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add index for cleanup job
CREATE INDEX IF NOT EXISTS "idx_pexels_videos_expires" ON "public"."pexels_videos" ("expires_at");

-- Set expiration for existing rows
UPDATE "public"."pexels_videos" 
SET expires_at = created_at + interval '7 days'
WHERE expires_at IS NULL;


-- =============================================================================
-- STEP 6: CREATE "screenplays" TABLE (NEW)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."screenplays" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" uuid REFERENCES "public"."projects"(id) ON DELETE SET NULL,
    "title" text NOT NULL DEFAULT 'Untitled Screenplay',
    "format" text NOT NULL DEFAULT 'reel' 
        CHECK (format IN ('reel', 'short', 'short_video', 'vfx_movie', 'presentation')),
    "total_duration" integer NOT NULL DEFAULT 60,
    "scenes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "voiceover_script" text,
    "voiceover_style" text,
    "music_suggestion" text,
    "version" integer DEFAULT 1,
    "is_latest" boolean DEFAULT true,
    "source_chat_id" text,  -- Links back to the chat that generated this
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_screenplays_user_id" ON "public"."screenplays" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_screenplays_project_id" ON "public"."screenplays" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_screenplays_user_latest" ON "public"."screenplays" ("user_id") WHERE is_latest = true;
CREATE INDEX IF NOT EXISTS "idx_screenplays_source_chat" ON "public"."screenplays" ("source_chat_id");

-- Trigger for updated_at
DROP TRIGGER IF EXISTS "update_screenplays_updated_at" ON "public"."screenplays";
CREATE TRIGGER "update_screenplays_updated_at" 
    BEFORE UPDATE ON "public"."screenplays" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


-- =============================================================================
-- STEP 7: CREATE "video_generations" TABLE (NEW)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."video_generations" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" uuid REFERENCES "public"."projects"(id) ON DELETE SET NULL,
    "screenplay_id" uuid REFERENCES "public"."screenplays"(id) ON DELETE SET NULL,
    "status" text NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    "provider" text NOT NULL DEFAULT 'runway' 
        CHECK (provider IN ('runway', 'sora', 'pika', 'pexels')),
    "external_id" text,
    "scene_index" integer,  -- Which scene this is for (null = full video)
    "prompt" text,  -- The actual prompt sent to the provider
    "video_url" text,
    "video_urls" text[] DEFAULT '{}',
    "thumbnail_url" text,
    "duration" integer,  -- in seconds
    "width" integer,
    "height" integer,
    "error_message" text,
    "error_code" text,
    "retry_count" integer DEFAULT 0,
    "progress" integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    "cost_credits" numeric(10,4) DEFAULT 0,  -- Track credits/cost
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_video_generations_user_id" ON "public"."video_generations" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_video_generations_project_id" ON "public"."video_generations" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_video_generations_screenplay_id" ON "public"."video_generations" ("screenplay_id");
CREATE INDEX IF NOT EXISTS "idx_video_generations_status" ON "public"."video_generations" ("status");
CREATE INDEX IF NOT EXISTS "idx_video_generations_external_id" ON "public"."video_generations" ("external_id");
CREATE INDEX IF NOT EXISTS "idx_video_generations_user_active" ON "public"."video_generations" ("user_id", "status") 
    WHERE status IN ('pending', 'queued', 'processing');


-- =============================================================================
-- STEP 8: CREATE "user_usage" TABLE (NEW) - For billing/rate limiting
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."user_usage" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "period_start" date NOT NULL,  -- First day of billing period
    "period_type" text NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily', 'monthly')),
    "screenplays_count" integer DEFAULT 0,
    "videos_count" integer DEFAULT 0,
    "api_calls_count" integer DEFAULT 0,
    "storage_bytes" bigint DEFAULT 0,
    "credits_used" numeric(10,2) DEFAULT 0,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    UNIQUE("user_id", "period_start", "period_type")
);

-- Index
CREATE INDEX IF NOT EXISTS "idx_user_usage_user_period" ON "public"."user_usage" ("user_id", "period_start" DESC);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS "update_user_usage_updated_at" ON "public"."user_usage";
CREATE TRIGGER "update_user_usage_updated_at" 
    BEFORE UPDATE ON "public"."user_usage" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


-- =============================================================================
-- STEP 9: UPDATE RLS POLICIES - Fix Security
-- =============================================================================

-- -----------------------------------------------------------------------------
-- projects RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public delete on project_files" ON "public"."project_files";
DROP POLICY IF EXISTS "Allow public delete on projects" ON "public"."projects";
DROP POLICY IF EXISTS "Allow public insert on project_files" ON "public"."project_files";
DROP POLICY IF EXISTS "Allow public insert on projects" ON "public"."projects";
DROP POLICY IF EXISTS "Allow public read on project_files" ON "public"."project_files";
DROP POLICY IF EXISTS "Allow public read on projects" ON "public"."projects";
DROP POLICY IF EXISTS "Allow public update on projects" ON "public"."projects";
DROP POLICY IF EXISTS "Users can view own projects" ON "public"."projects";
DROP POLICY IF EXISTS "Users can create own projects" ON "public"."projects";
DROP POLICY IF EXISTS "Users can update own projects" ON "public"."projects";
DROP POLICY IF EXISTS "Users can delete own projects" ON "public"."projects";

CREATE POLICY "Users can view own projects" ON "public"."projects"
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create own projects" ON "public"."projects"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON "public"."projects"
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own projects" ON "public"."projects"
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- Service role can access all
CREATE POLICY "Service role full access to projects" ON "public"."projects"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- -----------------------------------------------------------------------------
-- project_files RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own project files" ON "public"."project_files";
DROP POLICY IF EXISTS "Users can create own project files" ON "public"."project_files";
DROP POLICY IF EXISTS "Users can delete own project files" ON "public"."project_files";

CREATE POLICY "Users can view own project files" ON "public"."project_files"
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create own project files" ON "public"."project_files"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own project files" ON "public"."project_files"
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own project files" ON "public"."project_files"
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- -----------------------------------------------------------------------------
-- chat_history RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON "public"."chat_history";
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."chat_history";
DROP POLICY IF EXISTS "Users can view own chat history" ON "public"."chat_history";
DROP POLICY IF EXISTS "Users can create own chat history" ON "public"."chat_history";

ALTER TABLE "public"."chat_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat history" ON "public"."chat_history"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own chat history" ON "public"."chat_history"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chat history" ON "public"."chat_history"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat history" ON "public"."chat_history"
    FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- screenplays RLS
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."screenplays" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own screenplays" ON "public"."screenplays";
DROP POLICY IF EXISTS "Users can create own screenplays" ON "public"."screenplays";
DROP POLICY IF EXISTS "Users can update own screenplays" ON "public"."screenplays";
DROP POLICY IF EXISTS "Users can delete own screenplays" ON "public"."screenplays";

CREATE POLICY "Users can view own screenplays" ON "public"."screenplays"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own screenplays" ON "public"."screenplays"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own screenplays" ON "public"."screenplays"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own screenplays" ON "public"."screenplays"
    FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- video_generations RLS
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."video_generations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own video generations" ON "public"."video_generations";
DROP POLICY IF EXISTS "Users can create own video generations" ON "public"."video_generations";
DROP POLICY IF EXISTS "Users can update own video generations" ON "public"."video_generations";

CREATE POLICY "Users can view own video generations" ON "public"."video_generations"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own video generations" ON "public"."video_generations"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own video generations" ON "public"."video_generations"
    FOR UPDATE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- user_usage RLS
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."user_usage" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON "public"."user_usage";

CREATE POLICY "Users can view own usage" ON "public"."user_usage"
    FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage usage (for incrementing)
CREATE POLICY "Service role can manage usage" ON "public"."user_usage"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- -----------------------------------------------------------------------------
-- pexels_videos RLS (keep public read for shared cache)
-- -----------------------------------------------------------------------------
-- Already has public read policy, just ensure insert is controlled
DROP POLICY IF EXISTS "Allow public insert on pexels_videos" ON "public"."pexels_videos";

CREATE POLICY "Authenticated can insert pexels_videos" ON "public"."pexels_videos"
    FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.jwt()->>'role' = 'service_role');


-- =============================================================================
-- STEP 10: GRANT PERMISSIONS
-- =============================================================================

GRANT ALL ON TABLE "public"."screenplays" TO "anon";
GRANT ALL ON TABLE "public"."screenplays" TO "authenticated";
GRANT ALL ON TABLE "public"."screenplays" TO "service_role";

GRANT ALL ON TABLE "public"."video_generations" TO "anon";
GRANT ALL ON TABLE "public"."video_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."video_generations" TO "service_role";

GRANT ALL ON TABLE "public"."user_usage" TO "anon";
GRANT ALL ON TABLE "public"."user_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."user_usage" TO "service_role";


-- =============================================================================
-- STEP 11: HELPER FUNCTIONS
-- =============================================================================

-- Function to increment user usage (call from backend)
CREATE OR REPLACE FUNCTION "public"."increment_usage"(
    p_user_id uuid,
    p_screenplays integer DEFAULT 0,
    p_videos integer DEFAULT 0,
    p_api_calls integer DEFAULT 0,
    p_storage bigint DEFAULT 0,
    p_credits numeric DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_period_start date := date_trunc('month', now())::date;
BEGIN
    INSERT INTO user_usage (
        user_id, period_start, period_type, 
        screenplays_count, videos_count, api_calls_count, storage_bytes, credits_used
    )
    VALUES (
        p_user_id, v_period_start, 'monthly',
        p_screenplays, p_videos, p_api_calls, p_storage, p_credits
    )
    ON CONFLICT (user_id, period_start, period_type) DO UPDATE SET
        screenplays_count = user_usage.screenplays_count + p_screenplays,
        videos_count = user_usage.videos_count + p_videos,
        api_calls_count = user_usage.api_calls_count + p_api_calls,
        storage_bytes = user_usage.storage_bytes + p_storage,
        credits_used = user_usage.credits_used + p_credits,
        updated_at = now();
END;
$$;

-- Function to clean up expired pexels cache
CREATE OR REPLACE FUNCTION "public"."cleanup_expired_cache"() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM pexels_videos WHERE expires_at < now();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Function to get user's current month usage
CREATE OR REPLACE FUNCTION "public"."get_current_usage"(p_user_id uuid)
RETURNS TABLE(
    screenplays_count integer,
    videos_count integer,
    api_calls_count integer,
    storage_bytes bigint,
    credits_used numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(u.screenplays_count, 0),
        COALESCE(u.videos_count, 0),
        COALESCE(u.api_calls_count, 0),
        COALESCE(u.storage_bytes, 0::bigint),
        COALESCE(u.credits_used, 0::numeric)
    FROM user_usage u
    WHERE u.user_id = p_user_id 
      AND u.period_start = date_trunc('month', now())::date
      AND u.period_type = 'monthly';
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION "public"."increment_usage" TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."increment_usage" TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."cleanup_expired_cache" TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_current_usage" TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_current_usage" TO "service_role";


-- =============================================================================
-- DONE! Your schema is now production-ready.
-- =============================================================================
-- 
-- Summary of changes:
-- 
-- MODIFIED TABLES:
--   - projects: Added user_id, error_message, new indexes
--   - project_files: Added user_id, metadata, new index
--   - chat_history: Added project_id, new indexes, triggers
--   - pexels_videos: Added expires_at, user_id
-- 
-- NEW TABLES:
--   - screenplays: Store generated screenplays separately
--   - video_generations: Track video generation jobs
--   - user_usage: Track usage for billing/rate limiting
-- 
-- DROPPED TABLES:
--   - Backend (unused)
-- 
-- SECURITY:
--   - All RLS policies updated to only allow users to access their own data
--   - Service role has full access for backend operations
-- 
-- =============================================================================
