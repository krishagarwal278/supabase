# 🧠 Agent Skills Directory — `supabase` (Videaa Backend)

This directory contains role-based skill instruction files for an autonomous
agent sustaining the **Videaa backend** at production quality. This is the
Express.js + Supabase + AI orchestration layer that powers screenplay
generation, slideshow creation, and video production for the Videaa platform.

> ⚠️ **Backend and frontend both deploy on Railway only (no Vercel).**
> The backend must be always available. The production frontend (e.g. www.videaa.com)
> must have `VITE_API_URL` set to the backend Railway URL so it does not fall back
> to localhost. Any agent working on this repo must ensure changes are deployable
> on Railway without manual intervention.

---

## 📁 Skill Files

| File | Role | Activate When... |
|------|------|-----------------|
| [`SKILL_backend_engineer.md`](./SKILL_backend_engineer.md) | Senior Backend Engineer | Writing/reviewing Express routes, middleware, service logic |
| [`SKILL_ai_pipeline.md`](./SKILL_ai_pipeline.md) | AI Pipeline Engineer | Screenplay generation, slideshow logic, video quality, OpenAI integration |
| [`SKILL_database.md`](./SKILL_database.md) | Database / Supabase Engineer | Schema changes, migrations, RLS policies, query optimization |
| [`SKILL_devops_backend.md`](./SKILL_devops_backend.md) | DevOps / Platform Engineer | Railway deployment, CI/CD, env vars, health checks, always-on reliability |
| [`SKILL_debugger_backend.md`](./SKILL_debugger_backend.md) | Backend Debugger | Broken routes, AI pipeline failures, DB errors, Railway incidents |

---

## 🔁 How to Use These Skills

1. **Classify the task** — feature, AI pipeline, DB change, deploy, or bug?
2. **Read the matching skill file in full** before writing anything.
3. **Combine skills when needed** — a new screenplay endpoint needs
   BACKEND_ENGINEER + AI_PIPELINE; a schema change needs DATABASE + DEVOPS_BACKEND.
4. **The backend must always be deployable to Railway** — never leave it in a
   state that only works with a specific local setup.

---

## 🗂️ Project Snapshot

| Dimension | Details |
|-----------|---------|
| **Product** | Videaa — AI video generator from docs/PDFs/slides |
| **Repo** | `github.com/krishagarwal278/supabase` |
| **Frontend repo** | `github.com/krishagarwal278/content-creator-ai` |
| **Runtime** | Node.js 20+ (mandatory) |
| **Backend framework** | Express.js (lives in `backend/`) |
| **Language** | TypeScript (87%) + PLpgSQL (12%) |
| **Database** | Supabase (PostgreSQL + Auth + Storage + RLS) |
| **AI** | OpenAI API (screenplay generation, script structuring) |
| **Hosting** | Railway only (backend + frontend); auto-deploys from `main`; no Vercel |
| **Config** | `railway.json` at repo root |
| **Migrations** | `migrations/` directory (versioned SQL files) |
| **Schema snapshot** | `schema.sql` at repo root |
| **Pexels** | ❌ Being stashed — `functions/search-pexels-videos/` is deprecated |

---

## 🎯 Current Product Priorities (in order)

1. **Screenplay generation** — AI-powered script creation from user input/docs
2. **Slideshow generation** — converting screenplay into timed visual slides
3. **Video quality** — producing high-quality video output from slideshows (next phase)

All new development must serve one of these three goals. Do not build
infrastructure that doesn't directly advance them.

---

## ⚠️ Hard Rules (All Roles)

- **Backend runs on Railway — not localhost.** Every change must be
  Railway-deployable without manual SSH or file editing.
- **Never commit secrets.** `.env` is gitignored. Use `.env.example` for templates.
  Set real values in Railway environment variables.
- **Never use the Pexels integration.** `functions/search-pexels-videos/` is
  deprecated. Do not reference or re-enable it.
- **`SUPABASE_SERVICE_ROLE_KEY` stays on Railway only** — never in frontend vars.
- **All schema changes go through `migrations/`** — never alter production
  Supabase tables via the dashboard without a corresponding migration file.
- **Never break the frontend contract.** The `content-creator-ai` frontend
  (deployed on Railway as e.g. www.videaa.com) calls this backend. Any breaking
  API change requires a coordinated deploy. The frontend must have `VITE_API_URL`
  set to the backend Railway URL in its Railway service so production does not use localhost.
- **`.DS_Store` must be gitignored** — it's currently in the repo root and
  must be cleaned up.
