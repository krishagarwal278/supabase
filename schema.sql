-- =============================================================================
-- PRODUCTION SCHEMA - Final State After Migration
-- =============================================================================
-- This is the complete schema after applying migrations/20260217_scalable_schema.sql
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

COMMENT ON SCHEMA "public" IS 'standard public schema';

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

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

SET default_tablespace = '';
SET default_table_access_method = "heap";

-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- projects - Main project table with user ownership
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" REFERENCES auth.users(id) ON DELETE CASCADE,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "content_type" "text" NOT NULL,
    "target_duration" integer DEFAULT 60 NOT NULL,
    "model" "text" DEFAULT 'gpt-4o'::"text" NOT NULL,
    "voiceover_enabled" boolean DEFAULT false NOT NULL,
    "captions_enabled" boolean DEFAULT true NOT NULL,
    "thumbnail_url" "text",
    "video_url" "text",
    "script" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_content_type_check" CHECK (("content_type" = ANY (ARRAY['reel'::"text", 'short'::"text", 'vfx_movie'::"text", 'presentation'::"text"]))),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);

ALTER TABLE "public"."projects" OWNER TO "postgres";

-- Projects indexes
CREATE INDEX "idx_projects_user_id" ON "public"."projects" USING "btree" ("user_id");
CREATE INDEX "idx_projects_user_created" ON "public"."projects" USING "btree" ("user_id", "created_at" DESC);
CREATE INDEX "idx_projects_user_status" ON "public"."projects" USING "btree" ("user_id", "status");
CREATE INDEX "idx_projects_created_at" ON "public"."projects" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");

-- Projects trigger
CREATE OR REPLACE TRIGGER "update_projects_updated_at" 
    BEFORE UPDATE ON "public"."projects" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- -----------------------------------------------------------------------------
-- project_files - Files attached to projects
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."project_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "project_id" "uuid" NOT NULL REFERENCES "public"."projects"("id") ON DELETE CASCADE,
    "user_id" "uuid" REFERENCES auth.users(id) ON DELETE CASCADE,
    "file_name" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "file_url" "text",
    "processed" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."project_files" OWNER TO "postgres";

-- Project files indexes
CREATE INDEX "idx_project_files_project_id" ON "public"."project_files" USING "btree" ("project_id");
CREATE INDEX "idx_project_files_user_id" ON "public"."project_files" USING "btree" ("user_id");

-- -----------------------------------------------------------------------------
-- chat_history - Chat messages for AI interactions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."chat_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" "uuid" REFERENCES "public"."projects"("id") ON DELETE SET NULL,
    "username" "text" NOT NULL,
    "chat_id" "text" NOT NULL,
    "message" "text" NOT NULL,
    "role" "text" NOT NULL,
    "type_of_assets" "text"[] DEFAULT '{}'::"text"[],
    "hours_spent" numeric DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_history_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);

ALTER TABLE "public"."chat_history" OWNER TO "postgres";

-- Chat history indexes
CREATE INDEX "idx_chat_history_user_id" ON "public"."chat_history" USING "btree" ("user_id");
CREATE INDEX "idx_chat_history_user_chat" ON "public"."chat_history" USING "btree" ("user_id", "chat_id");
CREATE INDEX "idx_chat_history_project" ON "public"."chat_history" USING "btree" ("project_id");
CREATE INDEX "idx_chat_history_created" ON "public"."chat_history" USING "btree" ("created_at" DESC);

-- Chat history trigger
CREATE OR REPLACE TRIGGER "update_chat_history_updated_at" 
    BEFORE UPDATE ON "public"."chat_history" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- -----------------------------------------------------------------------------
-- screenplays - Generated screenplays/scripts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."screenplays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" "uuid" REFERENCES "public"."projects"("id") ON DELETE SET NULL,
    "title" "text" NOT NULL DEFAULT 'Untitled Screenplay',
    "format" "text" NOT NULL DEFAULT 'reel',
    "total_duration" integer NOT NULL DEFAULT 60,
    "scenes" "jsonb" NOT NULL DEFAULT '[]'::"jsonb",
    "voiceover_script" "text",
    "voiceover_style" "text",
    "music_suggestion" "text",
    "version" integer DEFAULT 1,
    "is_latest" boolean DEFAULT true,
    "source_chat_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "screenplays_format_check" CHECK (("format" = ANY (ARRAY['reel'::"text", 'short'::"text", 'short_video'::"text", 'vfx_movie'::"text", 'presentation'::"text"])))
);

ALTER TABLE "public"."screenplays" OWNER TO "postgres";

-- Screenplays indexes
CREATE INDEX "idx_screenplays_user_id" ON "public"."screenplays" USING "btree" ("user_id");
CREATE INDEX "idx_screenplays_project_id" ON "public"."screenplays" USING "btree" ("project_id");
CREATE INDEX "idx_screenplays_user_latest" ON "public"."screenplays" USING "btree" ("user_id") WHERE is_latest = true;
CREATE INDEX "idx_screenplays_source_chat" ON "public"."screenplays" USING "btree" ("source_chat_id");

-- Screenplays trigger
CREATE OR REPLACE TRIGGER "update_screenplays_updated_at" 
    BEFORE UPDATE ON "public"."screenplays" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- -----------------------------------------------------------------------------
-- video_generations - Track video generation jobs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."video_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" "uuid" REFERENCES "public"."projects"("id") ON DELETE SET NULL,
    "screenplay_id" "uuid" REFERENCES "public"."screenplays"("id") ON DELETE SET NULL,
    "status" "text" NOT NULL DEFAULT 'pending',
    "provider" "text" NOT NULL DEFAULT 'runway',
    "external_id" "text",
    "scene_index" integer,
    "prompt" "text",
    "video_url" "text",
    "video_urls" "text"[] DEFAULT '{}'::"text"[],
    "thumbnail_url" "text",
    "duration" integer,
    "width" integer,
    "height" integer,
    "error_message" "text",
    "error_code" "text",
    "retry_count" integer DEFAULT 0,
    "progress" integer DEFAULT 0,
    "cost_credits" numeric(10,4) DEFAULT 0,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "video_generations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'queued'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "video_generations_provider_check" CHECK (("provider" = ANY (ARRAY['runway'::"text", 'sora'::"text", 'pika'::"text", 'pexels'::"text"]))),
    CONSTRAINT "video_generations_progress_check" CHECK (("progress" >= 0 AND "progress" <= 100))
);

ALTER TABLE "public"."video_generations" OWNER TO "postgres";

-- Video generations indexes
CREATE INDEX "idx_video_generations_user_id" ON "public"."video_generations" USING "btree" ("user_id");
CREATE INDEX "idx_video_generations_project_id" ON "public"."video_generations" USING "btree" ("project_id");
CREATE INDEX "idx_video_generations_screenplay_id" ON "public"."video_generations" USING "btree" ("screenplay_id");
CREATE INDEX "idx_video_generations_status" ON "public"."video_generations" USING "btree" ("status");
CREATE INDEX "idx_video_generations_external_id" ON "public"."video_generations" USING "btree" ("external_id");
CREATE INDEX "idx_video_generations_user_active" ON "public"."video_generations" USING "btree" ("user_id", "status") 
    WHERE status IN ('pending', 'queued', 'processing');

-- -----------------------------------------------------------------------------
-- pexels_videos - Cache for Pexels stock videos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."pexels_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "pexels_id" integer NOT NULL UNIQUE,
    "user_id" "uuid" REFERENCES auth.users(id) ON DELETE SET NULL,
    "query" "text" NOT NULL,
    "url" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "duration" integer NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "user_name" "text",
    "expires_at" timestamp with time zone DEFAULT (now() + interval '7 days'),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."pexels_videos" OWNER TO "postgres";

-- Pexels videos indexes
CREATE INDEX "idx_pexels_videos_query" ON "public"."pexels_videos" USING "btree" ("query");
CREATE INDEX "idx_pexels_videos_expires" ON "public"."pexels_videos" USING "btree" ("expires_at");

-- -----------------------------------------------------------------------------
-- user_usage - Track API usage for billing/rate limiting
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."user_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "period_start" date NOT NULL,
    "period_type" "text" NOT NULL DEFAULT 'monthly',
    "screenplays_count" integer DEFAULT 0,
    "videos_count" integer DEFAULT 0,
    "api_calls_count" integer DEFAULT 0,
    "storage_bytes" bigint DEFAULT 0,
    "credits_used" numeric(10,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_usage_period_type_check" CHECK (("period_type" = ANY (ARRAY['daily'::"text", 'monthly'::"text"]))),
    UNIQUE("user_id", "period_start", "period_type")
);

ALTER TABLE "public"."user_usage" OWNER TO "postgres";

-- User usage indexes
CREATE INDEX "idx_user_usage_user_period" ON "public"."user_usage" USING "btree" ("user_id", "period_start" DESC);

-- User usage trigger
CREATE OR REPLACE TRIGGER "update_user_usage_updated_at" 
    BEFORE UPDATE ON "public"."user_usage" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Projects RLS
ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON "public"."projects"
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create own projects" ON "public"."projects"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON "public"."projects"
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own projects" ON "public"."projects"
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Service role full access to projects" ON "public"."projects"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Project Files RLS
ALTER TABLE "public"."project_files" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project files" ON "public"."project_files"
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create own project files" ON "public"."project_files"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own project files" ON "public"."project_files"
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own project files" ON "public"."project_files"
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- Chat History RLS
ALTER TABLE "public"."chat_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat history" ON "public"."chat_history"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own chat history" ON "public"."chat_history"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chat history" ON "public"."chat_history"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat history" ON "public"."chat_history"
    FOR DELETE USING (auth.uid() = user_id);

-- Screenplays RLS
ALTER TABLE "public"."screenplays" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own screenplays" ON "public"."screenplays"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own screenplays" ON "public"."screenplays"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own screenplays" ON "public"."screenplays"
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own screenplays" ON "public"."screenplays"
    FOR DELETE USING (auth.uid() = user_id);

-- Video Generations RLS
ALTER TABLE "public"."video_generations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own video generations" ON "public"."video_generations"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own video generations" ON "public"."video_generations"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own video generations" ON "public"."video_generations"
    FOR UPDATE USING (auth.uid() = user_id);

-- Pexels Videos RLS (shared cache - public read)
ALTER TABLE "public"."pexels_videos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on pexels_videos" ON "public"."pexels_videos"
    FOR SELECT USING (true);

CREATE POLICY "Authenticated can insert pexels_videos" ON "public"."pexels_videos"
    FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.jwt()->>'role' = 'service_role');

-- User Usage RLS
ALTER TABLE "public"."user_usage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON "public"."user_usage"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage usage" ON "public"."user_usage"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

-- Functions
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."increment_usage" TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."increment_usage" TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."cleanup_expired_cache" TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_current_usage" TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_current_usage" TO "service_role";

-- Tables
GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";

GRANT ALL ON TABLE "public"."project_files" TO "anon";
GRANT ALL ON TABLE "public"."project_files" TO "authenticated";
GRANT ALL ON TABLE "public"."project_files" TO "service_role";

GRANT ALL ON TABLE "public"."chat_history" TO "anon";
GRANT ALL ON TABLE "public"."chat_history" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_history" TO "service_role";

GRANT ALL ON TABLE "public"."screenplays" TO "anon";
GRANT ALL ON TABLE "public"."screenplays" TO "authenticated";
GRANT ALL ON TABLE "public"."screenplays" TO "service_role";

GRANT ALL ON TABLE "public"."video_generations" TO "anon";
GRANT ALL ON TABLE "public"."video_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."video_generations" TO "service_role";

GRANT ALL ON TABLE "public"."pexels_videos" TO "anon";
GRANT ALL ON TABLE "public"."pexels_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."pexels_videos" TO "service_role";

GRANT ALL ON TABLE "public"."user_usage" TO "anon";
GRANT ALL ON TABLE "public"."user_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."user_usage" TO "service_role";

-- Default privileges
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
