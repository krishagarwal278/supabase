import OpenAI from 'https://deno.land/x/openai@v4.24.0/mod.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from '@supabase/supabase-js'
import { env } from 'process';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = env.SUPABASE_URL!;  
const supabaseAnonKey = env.SUPABASE_ANON_KEY!;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, perPage = 10, orientation = 'landscape' } = await req.json();
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pexelsApiKey = env.PEXELS_API_KEY;
    if (!pexelsApiKey) {
      console.error('PEXELS_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Pexels API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Searching Pexels videos for: "${query}", orientation: ${orientation}, perPage: ${perPage}`);

    const searchParams = new URLSearchParams({
      query,
      per_page: perPage.toString(),
      orientation,
    });

    const response = await fetch(`https://api.pexels.com/videos/search?${searchParams}`, {
      headers: {
        'Authorization': pexelsApiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pexels API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to search Pexels videos' }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log(`Found ${data.videos?.length || 0} videos`);

    // Transform the response to a cleaner format
    const videos = data.videos?.map((video: any) => ({
      id: video.id,
      url: video.url,
      image: video.image,
      duration: video.duration,
      width: video.width,
      height: video.height,
      user: video.user?.name || 'Unknown',
      videoFiles: video.video_files?.map((file: any) => ({
        id: file.id,
        quality: file.quality,
        fileType: file.file_type,
        width: file.width,
        height: file.height,
        link: file.link,
      })) || [],
    })) || [];

    return new Response(
      JSON.stringify({ videos, totalResults: data.total_results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in search-pexels-videos function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
