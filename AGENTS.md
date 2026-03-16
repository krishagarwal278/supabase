# Agent instructions (supabase repo)

This repo contains the **Videaa backend** (Express in `backend/`) and Supabase config (migrations, schema, Edge Functions). Backend and frontend both deploy on **Railway only** (no Vercel).

## Backend alignment checklist

Before merging backend changes, ensure they align with the shared standards. Use the **Backend repo checklist**:

- **[docs/backend-checklist.md](docs/backend-checklist.md)** — Deployment (health, env vars, Node 20), CORS, Supabase service role, API contract, .env.example, layers (validation → logic → response), status codes, RLS.

That checklist is the single place that points to:

- **SKILL_devops:** Health check, Railway env vars, Node 20+.
- **SKILL_debugger:** CORS, Supabase service role, frontend API URL (VITE_BACKEND_URL in frontend repo).
- **SKILL_architect:** API contract, .env.example in both repos.
- **SKILL_fullstack (backend):** Layers (Zod → business logic → response), status codes, RLS.

## Environment variables (backend)

Backend reads from `process.env`. All variables are documented in **`backend/.env.example`**. For production, set them in Railway → Project → Variables. Key ones:

- `NODE_ENV=production`
- `PORT` (set by Railway)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `CORS_ORIGIN` (comma-separated, e.g. `https://www.videaa.com,https://videaa.com`)

Optional: `RUNWAY_API_KEY`, `FAL_AI_API_KEY`, `MOONSHOT_API_KEY`, `LOG_LEVEL`.

## Skills

Role-based skill files live in **`skills/`**. See **`skills/README.md`** for the index and when to use each skill.
