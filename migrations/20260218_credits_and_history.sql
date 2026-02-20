-- =============================================================================
-- CREDITS AND GENERATION HISTORY MIGRATION
-- =============================================================================
-- Run this in Supabase SQL Editor after the scalable schema migration
-- =============================================================================

-- =============================================================================
-- STEP 1: CREATE user_credits TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."user_credits" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "total_credits" integer NOT NULL DEFAULT 50,
    "used_credits" integer NOT NULL DEFAULT 0,
    "plan_type" text NOT NULL DEFAULT 'free' 
        CHECK (plan_type IN ('free', 'starter', 'pro', 'enterprise')),
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    UNIQUE("user_id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_user_credits_user_id" ON "public"."user_credits" ("user_id");

-- Trigger for updated_at
DROP TRIGGER IF EXISTS "update_user_credits_updated_at" ON "public"."user_credits";
CREATE TRIGGER "update_user_credits_updated_at" 
    BEFORE UPDATE ON "public"."user_credits" 
    FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


-- =============================================================================
-- STEP 2: CREATE credit_transactions TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."credit_transactions" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "amount" integer NOT NULL,
    "transaction_type" text NOT NULL 
        CHECK (transaction_type IN ('video_generation', 'credit_purchase', 'bonus_credits', 'refund', 'subscription_renewal', 'subscription', 'purchase', 'admin_adjustment')),
    "description" text NOT NULL,
    "reference_id" uuid,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_credit_transactions_user_id" ON "public"."credit_transactions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_credit_transactions_user_created" ON "public"."credit_transactions" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_credit_transactions_type" ON "public"."credit_transactions" ("transaction_type");


-- =============================================================================
-- STEP 3: CREATE generation_history TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."generation_history" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "project_id" uuid REFERENCES "public"."projects"(id) ON DELETE SET NULL,
    "project_name" text NOT NULL,
    "generation_type" text NOT NULL 
        CHECK (generation_type IN ('screenplay', 'video', 'enhancement')),
    "status" text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    "credits_used" integer NOT NULL DEFAULT 0,
    "format" text NOT NULL DEFAULT 'reel'
        CHECK (format IN ('reel', 'short_video', 'vfx_movie', 'presentation')),
    "duration" integer NOT NULL DEFAULT 30,
    "thumbnail_url" text,
    "video_url" text,
    "error_message" text,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_generation_history_user_id" ON "public"."generation_history" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_generation_history_user_created" ON "public"."generation_history" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_generation_history_user_type" ON "public"."generation_history" ("user_id", "generation_type");
CREATE INDEX IF NOT EXISTS "idx_generation_history_status" ON "public"."generation_history" ("status");
CREATE INDEX IF NOT EXISTS "idx_generation_history_project" ON "public"."generation_history" ("project_id");


-- =============================================================================
-- STEP 4: ROW LEVEL SECURITY
-- =============================================================================

-- user_credits RLS
ALTER TABLE "public"."user_credits" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credits" ON "public"."user_credits";
DROP POLICY IF EXISTS "Service role can manage credits" ON "public"."user_credits";

CREATE POLICY "Users can view own credits" ON "public"."user_credits"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage credits" ON "public"."user_credits"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- credit_transactions RLS
ALTER TABLE "public"."credit_transactions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON "public"."credit_transactions";
DROP POLICY IF EXISTS "Service role can manage transactions" ON "public"."credit_transactions";

CREATE POLICY "Users can view own transactions" ON "public"."credit_transactions"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage transactions" ON "public"."credit_transactions"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- generation_history RLS
ALTER TABLE "public"."generation_history" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own history" ON "public"."generation_history";
DROP POLICY IF EXISTS "Service role can manage history" ON "public"."generation_history";

CREATE POLICY "Users can view own history" ON "public"."generation_history"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage history" ON "public"."generation_history"
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');


-- =============================================================================
-- STEP 5: GRANTS
-- =============================================================================

GRANT ALL ON TABLE "public"."user_credits" TO "anon";
GRANT ALL ON TABLE "public"."user_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_credits" TO "service_role";

GRANT ALL ON TABLE "public"."credit_transactions" TO "anon";
GRANT ALL ON TABLE "public"."credit_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_transactions" TO "service_role";

GRANT ALL ON TABLE "public"."generation_history" TO "anon";
GRANT ALL ON TABLE "public"."generation_history" TO "authenticated";
GRANT ALL ON TABLE "public"."generation_history" TO "service_role";


-- =============================================================================
-- STEP 6: HELPER FUNCTIONS
-- =============================================================================

-- Function to initialize credits for a new user (can be called from auth trigger)
CREATE OR REPLACE FUNCTION "public"."initialize_user_credits"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_credits (user_id, total_credits, used_credits, plan_type)
    VALUES (NEW.id, 50, 0, 'free')
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN NEW;
END;
$$;

-- Optional: Create trigger to auto-initialize credits on user signup
-- Uncomment if you want automatic credit initialization
-- DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth.users;
-- CREATE TRIGGER "on_auth_user_created"
--     AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION "public"."initialize_user_credits"();


-- =============================================================================
-- DONE!
-- =============================================================================
-- 
-- New tables created:
-- - user_credits: Tracks total/used credits per user
-- - credit_transactions: Audit log of all credit changes
-- - generation_history: Record of all video/screenplay generations
--
-- Credit costs (defined in backend):
-- - Screenplay generation: FREE (0 credits)
-- - Reel video: 10 credits
-- - Short video: 15 credits
-- - VFX Movie: 25 credits
-- - Presentation: 20 credits
--
-- New users start with 50 free credits
-- =============================================================================
