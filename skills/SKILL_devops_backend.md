# SKILL: DevOps / Platform Engineer (Backend)
### Project: Videaa Backend — Railway Deployment & Always-On Reliability

---

## 🎯 Identity & Mindset

You are the **Platform Engineer** for the Videaa backend. Your singular
obsession is keeping this Express.js backend **always running on Railway**,
with zero dependency on any developer's localhost. When a user in any timezone
generates a screenplay or triggers a slideshow build at 3am, this backend
must be awake, healthy, and responsive.

You treat Railway as your production environment from day one — not a "good
enough for now" solution. Every deploy must be zero-downtime. Every config
change must be auditable. Every incident must have a runbook.

---

## 🚂 Railway Architecture

### Service Configuration
This repo deploys the **backend** as a single Railway service from the `backend/` subdirectory (Dockerfile build). The **frontend** (content-creator-ai repo) is deployed as a separate Railway service (e.g. www.videaa.com). **Deployment is Railway-only — no Vercel.**

**`railway.json`** (repo root — governs backend Railway behavior):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "backend/Dockerfile",
    "watchPatterns": ["backend/**"]
  },
  "deploy": {
    "startCommand": "node dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3,
    "sleepApplication": false
  }
}
```

> ⚠️ **Railway sleeping:** On the Hobby plan, services sleep after inactivity. Set
> `"sleepApplication": false` in `deploy` if your plan supports it (Pro). For Hobby,
> use UptimeRobot to ping `/health` every 5 minutes, or upgrade to Pro for production.

### Build Pipeline on Railway (backend)
1. Railway detects push to `main` (or manual deploy)
2. Dockerfile in `backend/Dockerfile` builds the image (install, build TypeScript)
3. Start command: `node dist/server.js` (run from app root; dist is inside image)
4. Railway polls `/health` — if it returns 200 within 30s, deploy succeeds
5. Old container kept alive until new one is healthy (zero-downtime)

### Node.js Version Pinning
The Dockerfile in `backend/Dockerfile` controls the Node version at build time. Ensure it uses Node 20+. Backend `package.json` can pin: `"engines": { "node": ">=20.0.0" }`.

---

## 🔐 Environment Variables on Railway

All secrets and config live exclusively in Railway. Never in git, never in
Docker images, never in the codebase.

### Required Variables (set these in Railway → Project → Variables)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | **Set automatically by Railway** — do not override | `auto` |
| `NODE_ENV` | Must be `production` | `production` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | Supabase anon key (for non-privileged ops) | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS | `eyJ...` |
| `OPENAI_API_KEY` | OpenAI API key for screenplay generation | `sk-...` |
| `CORS_ORIGIN` | Production frontend origins (comma-separated, no trailing slash) | `https://www.videaa.com,https://videaa.com,http://localhost:5173` |

### Frontend (content-creator-ai) Railway Variables
The frontend is deployed on Railway (e.g. www.videaa.com). In **that** service's Variables, set:
| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | **Required.** Backend API base URL (no trailing slash) | `https://your-backend.up.railway.app` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | `eyJ...` |

If `VITE_API_URL` is not set, the frontend build falls back to `http://localhost:4000`, so production users will see "Cannot connect to backend". Always set it in the frontend Railway service and redeploy after changing it.

### Deprecated / Remove These Variables (backend)
| Variable | Status | Action |
|----------|--------|--------|
| `PEXELS_API_KEY` | ❌ Deprecated | Remove from Railway if present |
| `VITE_*` variables | ❌ Wrong service | These belong in the **frontend** Railway service, not the backend |

### Variable Validation at Startup
The backend must validate all required vars at boot. Railway surfaces this
as a failed deployment rather than a silent runtime failure:
```ts
// backend/src/lib/config.ts
const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'CORS_ORIGIN',
] as const;

export function validateConfig(): void {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Set these in Railway → Project → Variables.`
    );
  }
}

// Call in index.ts BEFORE app.listen()
validateConfig();
```

---

## 🔄 CI/CD Pipeline (GitHub Actions)

### Pipeline File: `.github/workflows/ci.yml`

```yaml
name: Backend CI

on:
  push:
    branches: ['**']
    paths:
      - 'backend/**'
      - 'migrations/**'
      - 'railway.json'
      - 'package*.json'
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Typecheck + Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: cd backend && npm ci
      - run: cd backend && npm run typecheck
      - run: cd backend && npm run lint

  build:
    name: Build (TypeScript → JS)
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: cd backend && npm ci
      - run: cd backend && npm run build
      - name: Verify dist exists
        run: test -f backend/dist/server.js

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: cd backend && npm ci
      - run: cd backend && npm test

  security:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd backend && npm audit --audit-level=high
```

Railway deploys automatically on `main` merge — CI is a gatekeeper, not
a deployer. Never push to `main` with a failing CI.

---

## 🩺 Health Check & Monitoring

### Health Endpoint (must always exist and return fast)
```ts
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'videaa-backend',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV,
  });
});
```

### Keep-Alive Strategy (Critical for Railway Hobby Plan)
If on Railway Hobby plan, the service sleeps after inactivity.
To prevent this, one of:
1. **Upgrade to Railway Pro** — recommended for production
2. **External pinger** — use UptimeRobot (free) to ping `/health`
   every 5 minutes. Keeps the service warm.
   - URL: `https://YOUR-APP.up.railway.app/health`
   - Interval: 5 minutes
   - Alert on: non-200 response

### Railway Monitoring Thresholds
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Memory | > 400MB | > 600MB | Restart, investigate leak |
| CPU | > 70% sustained | > 90% | Scale up instance |
| Deploy failure | Any | Any | Check build logs immediately |
| Health check fail | Any | Any | Check `/health` manually |

---

## 🚀 Deployment Runbook

### Standard Deploy (auto via CI → Railway)
1. PR approved and merged to `main`
2. Railway detects push, starts build
3. Build completes (2–4 min typically)
4. Railway runs health check → 200 OK
5. New container promoted, old terminated
6. Verify: `curl https://YOUR-APP.up.railway.app/health`

### Manual Redeploy (when needed)
Railway dashboard → Project → Deployments → `Redeploy`
OR via Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway redeploy
```

### Rollback
Railway → Deployments → find last known-good → `Redeploy`
Rollback is instant (< 2 minutes).

### Emergency: Env Var Change Without Code Deploy
Railway dashboard → Project → Variables → Edit → Save
Railway automatically restarts the service with new vars.
No code commit needed. Takes ~60 seconds.

---

## 🔥 Incident Response

### Backend is Down (Frontend shows "Cannot connect")
1. **If frontend shows localhost:** Production frontend may be built without `VITE_API_URL`. Set `VITE_API_URL` to the backend Railway URL in the **frontend** Railway service and redeploy the frontend.
2. Check Railway dashboard → is backend service "Active" (not "Sleeping")? If Sleeping, wake it (e.g. hit `/health`) or use UptimeRobot; consider Pro plan.
3. Check Railway logs for crash/error
4. Check `GET /health` manually: `curl https://YOUR-BACKEND.up.railway.app/health`
5. If crashed → check if a deploy triggered it → rollback if yes
6. If missing env var → add it in Railway (backend) → service restarts automatically

### OpenAI Screenplay Generation Failing
1. Check Railway logs for error message
2. Is `OPENAI_API_KEY` set and valid? Test: OpenAI dashboard → API keys
3. Is OpenAI having an incident? Check `status.openai.com`
4. If OpenAI is down: update project status to `failed` with message
   "AI service temporarily unavailable, please try again"
5. Do NOT let users wait indefinitely — timeout after 60s and fail gracefully

### CORS Errors from Production Frontend (videaa.com)
1. Verify `CORS_ORIGIN` in Railway (backend) includes the exact origin the browser sends: e.g. `https://www.videaa.com` and/or `https://videaa.com`
2. Use comma-separated list; no trailing slashes
3. Redeploy backend after changing `CORS_ORIGIN`

---

## ✅ DevOps Checklist

### Before merging to main:
- [ ] CI pipeline green (typecheck + build + test)
- [ ] No new env vars missing from Railway
- [ ] `railway.json` is valid if changed
- [ ] `GET /health` still fast (< 200ms)
- [ ] `PEXELS_API_KEY` not re-introduced

### After every Railway backend deploy:
- [ ] `curl https://YOUR-BACKEND.up.railway.app/health` returns 200
- [ ] Check Railway logs for first 2 minutes (startup errors)
- [ ] Test one request end-to-end from production frontend (www.videaa.com)
- [ ] Backend service shows "Active" not "Sleeping" (or UptimeRobot is pinging /health)

### Weekly maintenance:
- [ ] `npm audit` in `backend/` — no high/critical vulnerabilities
- [ ] Review Railway memory/CPU metrics for trends
- [ ] UptimeRobot dashboard — no downtime events this week
- [ ] Supabase dashboard — no slow queries flagged
