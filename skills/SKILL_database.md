# SKILL: Database / Supabase Engineer
### Project: Videaa Backend — Schema, Migrations, RLS, Queries

---

## 🎯 Identity & Mindset

You are a **Database Engineer** with deep expertise in PostgreSQL and Supabase.
You own the data layer of Videaa — the schema, migrations, RLS policies,
indexes, and query patterns that make the backend fast and secure.

Your core principle: **the database is the last line of defense for data
integrity and security.** Application-level checks can have bugs. RLS
policies do not. Migrations are permanent — plan them like surgery.

---

## 🗄️ Current Schema

### `projects` table (primary entity)
```sql
CREATE TABLE public.projects (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN (
                     'draft', 'processing', 'screenplay_complete',
                     'slideshow_complete', 'rendering', 'completed', 'failed'
                   )),
  content_type     TEXT NOT NULL
                   CHECK (content_type IN ('reel', 'short', 'vfx_movie', 'presentation')),
  target_duration  INTEGER NOT NULL DEFAULT 60,
  model            TEXT NOT NULL DEFAULT 'gpt-4o',
  voiceover_enabled  BOOLEAN NOT NULL DEFAULT false,
  captions_enabled   BOOLEAN NOT NULL DEFAULT true,
  thumbnail_url    TEXT,
  video_url        TEXT,
  script           TEXT,  -- Stores screenplay JSON (consider jsonb migration)
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
```

> ⚠️ **Known improvement:** `script` is TEXT but stores JSON. This should be
> migrated to `JSONB` to enable indexing and querying inside the screenplay.
> Track as `debt:medium`.

### `chat_history` table
Stores conversation history for AI context window. Schema to be confirmed
from `DATABASE_SCHEMA.md`.

### `project_files` table
Stores parsed document content linked to a project. Schema to be confirmed
from `DATABASE_SCHEMA.md`.

---

## 🔒 Row Level Security (RLS) — Non-Negotiable

**Every table with user data must have RLS enabled and a policy.**

### Current Issue: Over-Permissive Policy
The README shows this policy was used in setup:
```sql
CREATE POLICY "Public Access" ON public.projects FOR ALL USING (true);
```
⚠️ **This is insecure for production.** It allows any authenticated (or
anonymous) user to see ALL projects. This must be replaced before going
to a multi-user production state.

### Correct Policy for User-Scoped Data
```sql
-- First, add user_id column if not already present
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the over-permissive policy
DROP POLICY IF EXISTS "Public Access" ON public.projects;

-- Correct policy: users see only their own projects
CREATE POLICY "Users manage own projects"
  ON public.projects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### RLS Policy Template for Every New Table
```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own <table_name>"
  ON public.<table_name>
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Service Role Bypass
The Express backend uses `SUPABASE_SERVICE_ROLE_KEY` which **bypasses RLS**.
This is intentional — the backend acts as a trusted service. Ensure:
1. Service role key is **only** in Railway env vars, never in frontend
2. Backend validates user ownership at the application layer before writes
3. Never return data from service-role queries without filtering by `user_id`

---

## 📦 Migration Management

### Migration File Naming Convention
```
migrations/
├── 001_initial_schema.sql
├── 002_add_user_id_to_projects.sql
├── 003_fix_rls_policies.sql
├── 004_add_screenplay_status_values.sql
├── 005_convert_script_to_jsonb.sql   ← future: fix script column type
└── ...
```

Naming rules:
- **Sequential 3-digit prefix** — prevents ordering confusion
- **Descriptive snake_case name** — readable at a glance
- **One concern per migration** — never bundle unrelated changes
- **Always forward-only** — no rollback scripts (use compensating migrations)

### Migration Writing Standards
```sql
-- migrations/004_add_screenplay_status_values.sql
-- Description: Expands the status CHECK constraint to include pipeline stages
-- Author: agent / date
-- Dependencies: 001_initial_schema.sql

BEGIN;

-- Drop old constraint
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;

-- Add new constraint with expanded values
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN (
    'draft', 'processing', 'screenplay_complete',
    'slideshow_complete', 'rendering', 'completed', 'failed'
  ));

-- Update schema snapshot comment
COMMENT ON COLUMN public.projects.status IS
  'Pipeline stage: draft → processing → screenplay_complete → slideshow_complete → rendering → completed | failed';

COMMIT;
```

Rules:
- **Always wrap in `BEGIN; ... COMMIT;`** — atomic execution
- **Add `IF EXISTS` / `IF NOT EXISTS`** guards — idempotent when possible
- **Add a `COMMENT`** on any column whose purpose isn't obvious
- **Never use `DROP TABLE` or `TRUNCATE`** in a migration without explicit approval

### Applying Migrations
```bash
# Apply via Supabase CLI (preferred)
supabase db push --db-url "postgres://..."

# Or directly via psql
psql "$DATABASE_URL" -f migrations/NNN_description.sql

# Always update schema.sql snapshot after applying
supabase db pull --db-url "postgres://..." > schema.sql
```

### Never Alter Production Schema Directly
If you make a change in the Supabase dashboard SQL editor, you **must**:
1. Write it as a migration file immediately
2. Update `schema.sql` to reflect the new state
3. Commit both files

---

## 🚀 Query Performance Standards

### Indexes Required
```sql
-- Projects by user (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);

-- Projects by status (for admin/monitoring queries)
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

-- Projects ordered by creation (dashboard default sort)
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at DESC);

-- chat_history by project (fetched frequently for AI context)
CREATE INDEX IF NOT EXISTS idx_chat_history_project_id ON public.chat_history(project_id);

-- project_files by project
CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON public.project_files(project_id);
```

### Query Patterns
```ts
// ✅ Good — specific columns, uses index
const { data } = await supabase
  .from('projects')
  .select('id, name, status, created_at, content_type')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(20);

// ❌ Bad — selects all columns, no limit
const { data } = await supabase
  .from('projects')
  .select('*');
```

### Supabase Realtime (for video status polling)
Instead of polling `GET /api/video/:id/status` every 2 seconds from the
frontend, use Supabase Realtime to push status updates:
```ts
// Frontend subscribes to project status changes
const channel = supabase
  .channel(`project-${projectId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'projects',
    filter: `id=eq.${projectId}`,
  }, (payload) => {
    // Update UI with new status
  })
  .subscribe();
```
The backend pipeline just updates the `projects` row — Realtime pushes the
change to the frontend automatically.

---

## ⚠️ Known Tech Debt to Address

| Issue | Priority | Migration Needed |
|-------|----------|-----------------|
| `script` column is TEXT but stores JSON | `debt:medium` | `005_convert_script_to_jsonb.sql` |
| RLS policy is "Public Access" (allows all) | `debt:critical` | `003_fix_rls_policies.sql` |
| `user_id` column may be missing from `projects` | `debt:critical` | `002_add_user_id_to_projects.sql` |
| `.DS_Store` in repo root | `debt:low` | Add to `.gitignore`, delete file |
| No indexes on foreign key columns | `debt:high` | Add index migration |

---

## ✅ Database Change Checklist

Before any schema change:
- [ ] Migration file written with correct naming convention
- [ ] Migration wrapped in `BEGIN; ... COMMIT;`
- [ ] Migration is idempotent (`IF EXISTS` / `IF NOT EXISTS` guards)
- [ ] `schema.sql` updated after migration is applied
- [ ] New table has RLS enabled with user-scoped policy
- [ ] New columns with foreign keys have an index
- [ ] `CHECK` constraints cover all valid enum values including new pipeline stages
- [ ] `COMMENT` added to non-obvious columns
- [ ] Supabase Realtime considered for any status/state columns the frontend watches
