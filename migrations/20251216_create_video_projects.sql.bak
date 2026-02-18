-- Create video_projects table for storing video generation data
CREATE TABLE IF NOT EXISTS video_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    format VARCHAR(50) NOT NULL CHECK (format IN ('reel', 'short_video', 'vfx_movie', 'presentation')),
    target_duration INTEGER NOT NULL DEFAULT 30,
    screenplay JSONB,
    background_video_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'screenplay_generated', 'processing', 'completed', 'failed')),
    voiceover_enabled BOOLEAN DEFAULT true,
    captions_enabled BOOLEAN DEFAULT true,
    output_video_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster user queries
CREATE INDEX IF NOT EXISTS idx_video_projects_user_id ON video_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_video_projects_status ON video_projects(status);

-- Enable Row Level Security
ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own projects
CREATE POLICY "Users can view own video projects"
    ON video_projects
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own projects
CREATE POLICY "Users can create own video projects"
    ON video_projects
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own projects
CREATE POLICY "Users can update own video projects"
    ON video_projects
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Policy: Users can delete their own projects
CREATE POLICY "Users can delete own video projects"
    ON video_projects
    FOR DELETE
    USING (auth.uid() = user_id);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_video_projects_updated_at ON video_projects;
CREATE TRIGGER update_video_projects_updated_at
    BEFORE UPDATE ON video_projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

