-- Migration: Update interest_submissions table with new fields
-- Date: 2026-02-21
-- Description: Add role, early_access_priority, video_topics, use_case, ai_experience fields

-- Add new columns to interest_submissions table
ALTER TABLE interest_submissions
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('student', 'self_learner', 'educator', 'content_creator', 'professional', 'developer', 'other')),
  ADD COLUMN IF NOT EXISTS early_access_priority TEXT NOT NULL DEFAULT 'just_exploring'
    CHECK (early_access_priority IN ('very_interested', 'somewhat_interested', 'just_exploring')),
  ADD COLUMN IF NOT EXISTS video_topics TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS use_case TEXT DEFAULT NULL
    CHECK (use_case IS NULL OR use_case IN ('create_learning_videos', 'summarize_concepts', 'study_faster', 'build_courses', 'content_creation', 'experimenting')),
  ADD COLUMN IF NOT EXISTS ai_experience TEXT DEFAULT NULL
    CHECK (ai_experience IS NULL OR ai_experience IN ('beginner', 'intermediate', 'advanced', 'power_user'));

-- Drop the phone column if it exists (no longer used)
ALTER TABLE interest_submissions
  DROP COLUMN IF EXISTS phone;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_interest_submissions_role ON interest_submissions(role);
CREATE INDEX IF NOT EXISTS idx_interest_submissions_priority ON interest_submissions(early_access_priority);

-- Add comment for documentation
COMMENT ON COLUMN interest_submissions.role IS 'User role: student, self_learner, educator, content_creator, professional, developer, other';
COMMENT ON COLUMN interest_submissions.early_access_priority IS 'Interest level: very_interested, somewhat_interested, just_exploring';
COMMENT ON COLUMN interest_submissions.video_topics IS 'Array of topics: technical_skills, business_finance, academic, creative_skills, language_learning, career_prep, personal_development';
COMMENT ON COLUMN interest_submissions.use_case IS 'Primary use case: create_learning_videos, summarize_concepts, study_faster, build_courses, content_creation, experimenting';
COMMENT ON COLUMN interest_submissions.ai_experience IS 'AI experience level: beginner, intermediate, advanced, power_user';
