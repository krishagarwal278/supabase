# Database Schema Design

This document describes the production-ready database schema for the video generation platform.

## Entity Relationship Diagram

```
                                    ┌─────────────────┐
                                    │   auth.users    │
                                    │ (Supabase Auth) │
                                    └────────┬────────┘
                                             │
         ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
         │                   │               │               │                   │
         ▼                   ▼               ▼               ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐ ┌─────────────┐
│    projects     │ │   screenplays   │ │ chat_history│ │  user_usage     │ │pexels_videos│
├─────────────────┤ ├─────────────────┤ ├─────────────┤ ├─────────────────┤ ├─────────────┤
│ id (PK)         │ │ id (PK)         │ │ id (PK)     │ │ id (PK)         │ │ id (PK)     │
│ user_id (FK)    │ │ user_id (FK)    │ │ user_id(FK) │ │ user_id (FK)    │ │ pexels_id   │
│ name            │ │ project_id (FK) │ │ project_id  │ │ period_start    │ │ user_id     │
│ description     │ │ title           │ │ chat_id     │ │ period_type     │ │ query       │
│ status          │ │ format          │ │ username    │ │ screenplays_cnt │ │ url         │
│ content_type    │ │ total_duration  │ │ message     │ │ videos_count    │ │ image_url   │
│ target_duration │ │ scenes (JSONB)  │ │ role        │ │ api_calls_count │ │ duration    │
│ model           │ │ voiceover_script│ │ metadata    │ │ storage_bytes   │ │ width/height│
│ voiceover_ena.. │ │ voiceover_style │ │ created_at  │ │ credits_used    │ │ expires_at  │
│ captions_ena..  │ │ music_suggestion│ │ last_updated│ └─────────────────┘ └─────────────┘
│ thumbnail_url   │ │ version         │ └─────────────┘
│ video_url       │ │ is_latest       │
│ script          │ │ source_chat_id  │
│ error_message   │ │ created_at      │
│ created_at      │ │ updated_at      │
│ updated_at      │ └────────┬────────┘
└────────┬────────┘          │
         │                   │
         │    ┌──────────────┘
         │    │
         ▼    ▼
┌─────────────────┐         ┌─────────────────────┐
│  project_files  │         │  video_generations  │
├─────────────────┤         ├─────────────────────┤
│ id (PK)         │         │ id (PK)             │
│ project_id (FK) │         │ user_id (FK)        │
│ user_id (FK)    │         │ project_id (FK)     │
│ file_name       │         │ screenplay_id (FK)  │
│ file_type       │         │ status              │
│ file_size       │         │ provider            │
│ file_url        │         │ external_id         │
│ processed       │         │ scene_index         │
│ metadata        │         │ prompt              │
│ created_at      │         │ video_url           │
└─────────────────┘         │ video_urls[]        │
                            │ thumbnail_url       │
                            │ duration/width/height│
                            │ error_message       │
                            │ retry_count         │
                            │ progress            │
                            │ cost_credits        │
                            │ started_at          │
                            │ completed_at        │
                            │ metadata (JSONB)    │
                            └─────────────────────┘
```

## Tables Overview

### Core Tables

| Table | Purpose | User-Scoped | RLS |
|-------|---------|-------------|-----|
| `projects` | Main video projects | ✅ | ✅ |
| `project_files` | Files attached to projects | ✅ | ✅ |
| `screenplays` | AI-generated screenplays with scenes | ✅ | ✅ |
| `video_generations` | Video generation jobs & status | ✅ | ✅ |
| `chat_history` | Chat/conversation history | ✅ | ✅ |
| `user_usage` | Usage tracking for billing/limits | ✅ | ✅ |
| `pexels_videos` | Video search cache (7-day expiry) | Optional | Public Read |

### Modified Tables (from original schema)

| Table | Changes Made |
|-------|--------------|
| `projects` | Added `user_id`, `error_message`, new indexes |
| `project_files` | Added `user_id`, `metadata` |
| `chat_history` | Added `project_id`, updated_at trigger, new indexes |
| `pexels_videos` | Added `expires_at`, `user_id` |

### New Tables

| Table | Purpose |
|-------|---------|
| `screenplays` | Store structured screenplay data with scenes JSONB |
| `video_generations` | Track video generation jobs from multiple providers |
| `user_usage` | Monthly usage tracking for rate limiting & billing |

### Dropped Tables

| Table | Reason |
|-------|--------|
| `Backend` | Unused placeholder table |

## Indexes for Performance

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| `projects` | `idx_projects_user_id` | `user_id` | User's projects lookup |
| `projects` | `idx_projects_user_created` | `user_id, created_at DESC` | User's recent projects |
| `projects` | `idx_projects_user_status` | `user_id, status` | Filter by user & status |
| `project_files` | `idx_project_files_user_id` | `user_id` | User's files lookup |
| `chat_history` | `idx_chat_history_user_chat` | `user_id, chat_id` | Conversation lookup |
| `chat_history` | `idx_chat_history_project` | `project_id` | Project's chat history |
| `screenplays` | `idx_screenplays_user_latest` | `user_id` (WHERE is_latest) | Latest screenplay only |
| `screenplays` | `idx_screenplays_source_chat` | `source_chat_id` | Link to generating chat |
| `video_generations` | `idx_video_generations_user_active` | `user_id, status` (WHERE active) | Active jobs |
| `video_generations` | `idx_video_generations_external_id` | `external_id` | Provider callback lookup |
| `pexels_videos` | `idx_pexels_videos_expires` | `expires_at` | Cleanup expired cache |
| `user_usage` | `idx_user_usage_user_period` | `user_id, period_start DESC` | Usage lookup |

## Helper Functions

### `increment_usage(p_user_id, p_screenplays, p_videos, p_api_calls, p_storage, p_credits)`
Atomically increment user's monthly usage stats. Handles upserts automatically.

```sql
SELECT increment_usage(
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    1,  -- screenplays
    2,  -- videos
    10, -- api_calls
    0,  -- storage_bytes
    5.5 -- credits
);
```

### `get_current_usage(p_user_id)`
Get user's current month usage statistics.

```sql
SELECT * FROM get_current_usage('550e8400-e29b-41d4-a716-446655440000'::uuid);
```

### `cleanup_expired_cache()`
Delete expired pexels video cache entries. Call periodically via cron.

```sql
SELECT cleanup_expired_cache(); -- Returns number of deleted rows
```

## Data Flow

```
User Request
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  projects   │────▶│  screenplays │────▶│  video_generations  │
│  (create)   │     │  (AI gen)    │     │  (process videos)   │
└─────────────┘     └──────────────┘     └─────────────────────┘
       │                   │                        │
       │                   ▼                        │
       │            ┌──────────────┐                │
       │            │ chat_history │                │
       │            │ (log conv.)  │                │
       │            └──────────────┘                │
       │                                           ▼
       │                                    ┌─────────────┐
       └───────────────────────────────────▶│ user_usage  │
                                            │ (track)     │
                                            └─────────────┘
```

## Running the Migration

### Option 1: Supabase SQL Editor (Recommended for Production)
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `migrations/20260217_scalable_schema.sql`
3. Execute step by step (sections are clearly marked)

### Option 2: Supabase CLI
```bash
cd /Users/krishagarwal/Desktop/supabase
supabase db push
```

### Option 3: Direct psql
```bash
psql $DATABASE_URL -f migrations/20260217_scalable_schema.sql
```

## Sample Queries

### Get user's projects with latest screenplay
```sql
SELECT p.*, s.title as screenplay_title, s.scenes, s.total_duration
FROM projects p
LEFT JOIN screenplays s ON s.project_id = p.id AND s.is_latest = true
WHERE p.user_id = auth.uid()
ORDER BY p.created_at DESC
LIMIT 20;
```

### Get user's active video generations
```sql
SELECT vg.*, p.name as project_name, s.title as screenplay_title
FROM video_generations vg
LEFT JOIN projects p ON p.id = vg.project_id
LEFT JOIN screenplays s ON s.id = vg.screenplay_id
WHERE vg.user_id = auth.uid() 
  AND vg.status IN ('pending', 'queued', 'processing')
ORDER BY vg.created_at DESC;
```

### Get user's chat history for a project
```sql
SELECT ch.*
FROM chat_history ch
WHERE ch.user_id = auth.uid() 
  AND ch.project_id = $1
ORDER BY ch.created_at ASC;
```

### Get monthly usage summary
```sql
SELECT 
    period_start,
    screenplays_count,
    videos_count,
    api_calls_count,
    credits_used
FROM user_usage
WHERE user_id = auth.uid() 
  AND period_type = 'monthly'
ORDER BY period_start DESC
LIMIT 12;
```

### Create a new video generation job
```sql
INSERT INTO video_generations (
    user_id, project_id, screenplay_id, 
    status, provider, prompt, scene_index
) VALUES (
    auth.uid(), $1, $2,
    'pending', 'runway', $3, $4
) RETURNING *;
```

## Security Notes

1. **RLS is enabled** on all tables - users can only access their own data
2. **Service role** has full access for backend operations
3. **Existing data** with `user_id = NULL` is accessible for backward compatibility
4. **pexels_videos** has public read access (it's a shared cache)
