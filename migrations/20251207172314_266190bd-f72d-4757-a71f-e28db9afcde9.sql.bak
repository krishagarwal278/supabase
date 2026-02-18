-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'failed')),
  content_type TEXT NOT NULL CHECK (content_type IN ('reel', 'short', 'vfx_movie', 'presentation')),
  target_duration INTEGER NOT NULL DEFAULT 60,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  voiceover_enabled BOOLEAN NOT NULL DEFAULT false,
  captions_enabled BOOLEAN NOT NULL DEFAULT true,
  thumbnail_url TEXT,
  video_url TEXT,
  script TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create project_files table for uploaded source files
CREATE TABLE public.project_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_url TEXT,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create pexels_videos table to cache video search results
CREATE TABLE public.pexels_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pexels_id INTEGER NOT NULL UNIQUE,
  query TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT NOT NULL,
  duration INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  user_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pexels_videos ENABLE ROW LEVEL SECURITY;

-- Public access policies (since no auth yet)
CREATE POLICY "Allow public read on projects" ON public.projects FOR SELECT USING (true);
CREATE POLICY "Allow public insert on projects" ON public.projects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on projects" ON public.projects FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on projects" ON public.projects FOR DELETE USING (true);

CREATE POLICY "Allow public read on project_files" ON public.project_files FOR SELECT USING (true);
CREATE POLICY "Allow public insert on project_files" ON public.project_files FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on project_files" ON public.project_files FOR DELETE USING (true);

CREATE POLICY "Allow public read on pexels_videos" ON public.pexels_videos FOR SELECT USING (true);
CREATE POLICY "Allow public insert on pexels_videos" ON public.pexels_videos FOR INSERT WITH CHECK (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_projects_created_at ON public.projects(created_at DESC);
CREATE INDEX idx_project_files_project_id ON public.project_files(project_id);
CREATE INDEX idx_pexels_videos_query ON public.pexels_videos(query);