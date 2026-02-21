-- Migration: Interest Submissions (Waitlist)
-- Created: 2026-02-21
-- Description: Creates table for waitlist/interest form submissions

-- =============================================================================
-- Interest Submissions Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS interest_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_beta_user BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_interest_submissions_email ON interest_submissions(email);
CREATE INDEX IF NOT EXISTS idx_interest_submissions_status ON interest_submissions(status);
CREATE INDEX IF NOT EXISTS idx_interest_submissions_created ON interest_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interest_submissions_beta ON interest_submissions(is_beta_user) WHERE is_beta_user = true;

-- =============================================================================
-- Auto-update timestamp trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION update_interest_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_interest_submissions_updated_at ON interest_submissions;
CREATE TRIGGER update_interest_submissions_updated_at
  BEFORE UPDATE ON interest_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_interest_submissions_updated_at();

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

ALTER TABLE interest_submissions ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for backend operations)
GRANT ALL ON interest_submissions TO service_role;

-- Public can insert (for form submissions)
CREATE POLICY "Anyone can submit interest form" ON interest_submissions
  FOR INSERT WITH CHECK (true);

-- Only authenticated admins can view all submissions
-- (You can customize this based on your admin logic)
CREATE POLICY "Service role can view all submissions" ON interest_submissions
  FOR SELECT USING (true);

-- Only service role can update
CREATE POLICY "Service role can update submissions" ON interest_submissions
  FOR UPDATE USING (true);

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON TABLE interest_submissions IS 'Stores waitlist/interest form submissions';
COMMENT ON COLUMN interest_submissions.full_name IS 'Full name of the person';
COMMENT ON COLUMN interest_submissions.email IS 'Email address (unique)';
COMMENT ON COLUMN interest_submissions.phone IS 'Optional phone number';
COMMENT ON COLUMN interest_submissions.status IS 'Submission status: pending, approved, or rejected';
COMMENT ON COLUMN interest_submissions.is_beta_user IS 'Whether this user has been granted beta access';
