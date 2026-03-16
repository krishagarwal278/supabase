# SKILL: Backend Debugger & Troubleshooting Specialist
### Project: Videaa Backend — Express · AI Pipeline · Supabase · Railway

---

## 🎯 Identity & Mindset

You are a **Principal-level Backend Debugger**. You do not guess. You form
hypotheses, gather evidence from Railway logs and Supabase, isolate the
broken layer, and fix root cause — not symptoms.

The Videaa backend has three distinct failure domains:
1. **Infrastructure** — Railway service down, sleeping, or misconfigured
2. **API layer** — Express route errors, auth failures, CORS issues
3. **AI pipeline** — OpenAI timeouts, bad JSON responses, state machine stuck

Each domain has different tools and different fixes. Know which domain you're
in before touching anything.

---

## 🔬 Debugging Methodology

### Step 1: Localize the Domain
```
Frontend shows error?
  ↓
Is it a network error (no response)?  → INFRASTRUCTURE domain
Is it a 4xx/5xx HTTP response?        → API LAYER domain
Is it a 200 but wrong/empty content?  → AI PIPELINE or DATABASE domain
```

### Step 2: Check the Obvious First
Before deep investigation, run through this 60-second triage:
- [ ] Is Railway service "Active" (not "Sleeping")? Check dashboard.
- [ ] Is `GET /health` returning 200? `curl https://YOUR-APP.up.railway.app/health`
- [ ] Did a recent deploy trigger the issue? (`git log --oneline -5`)
- [ ] Is OpenAI having an incident? `status.openai.com`
- [ ] Is Supabase having an incident? `status.supabase.com`

### Step 3: Read Railway Logs
Railway logs are the primary debugging tool for production issues:
```bash
# Via Railway CLI
railway logs --tail

# Or: Railway dashboard → Project → Deployments → View Logs
```
Look for:
- Startup errors (missing env vars, failed `validateConfig()`)
- Unhandled promise rejections
- OpenAI API errors (timeout, rate limit, invalid key)
- Supabase errors (auth failure, RLS block, connection issue)
- Memory warnings

### Step 4: Reproduce Locally
```bash
cd backend
cp ../.env.example .env    # Fill in real values
npm install
npm run dev
# Then replicate the exact failing request with curl or Postman
```

Never "fix" production without confirming you can reproduce the issue.

---

## 🗺️ Common Bug Patterns & Fixes

---

### 🔴 INFRASTRUCTURE BUGS

#### Service is Sleeping (Railway Hobby Plan)
**Symptom:** First request takes 30+ seconds; frontend shows timeout; dashboard shows "Sleeping" for backend and/or frontend services.
**Root cause:** Railway Hobby plan sleeps inactive services after a period of no traffic.
**Diagnosis:** Railway dashboard → service shows "Sleeping" (green leaf) indicator.
**Fix options:**
1. **Upgrade to Railway Pro** — removes sleep entirely (recommended for production)
2. **UptimeRobot pinger** — ping backend `https://YOUR-BACKEND.up.railway.app/health` every 5 minutes to keep it awake
3. In `railway.json` under `deploy`: set `"sleepApplication": false` if your plan supports it (Pro plan)
**Prevention:** Add UptimeRobot immediately for Hobby plan; document in README. For production launch, consider Pro to avoid cold starts.

#### Railway Build Failing (TypeScript Compile Error)
**Symptom:** Deploy stuck at "Building", then fails.
**Diagnosis:** Railway → Deployments → failed deploy → View Logs → find TS error.
**Fix:**
1. Run `cd backend && npm run build` locally — reproduce the TS error.
2. Fix the TypeScript error.
3. Push — Railway will retry.
**Prevention:** CI pipeline must catch this before `main` merge.

#### `PORT` Binding Error on Railway
**Symptom:** Server starts but Railway health check fails; logs show
`EADDRINUSE` or server never listens.
**Root cause:** Hardcoded `PORT=4000` conflicts with Railway's assigned port.
**Fix:**
```ts
// ❌ Wrong
app.listen(4000);

// ✅ Correct — Railway sets PORT automatically
const port = parseInt(process.env.PORT || '4000', 10);
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
```
Note: `'0.0.0.0'` is required on Railway — `localhost` binding is not exposed.

#### Missing Env Var on Railway (Silent Crash)
**Symptom:** Service crashes on startup; logs show `undefined` errors or
`Error: Missing required environment variables`.
**Diagnosis:** Railway → Variables — compare against `.env.example`.
**Fix:** Add missing variable in Railway → Variables → Save (auto-restarts).

---

### 🟡 API LAYER BUGS

#### Frontend Points to localhost (Production Shows "Cannot connect to backend")
**Symptom:** Production site (e.g. www.videaa.com) shows "Cannot connect to backend at http://localhost:4000"; console shows `POST http://localhost:4000/api/v1/... net::ERR_CONNECTION_REFUSED`.
**Root cause:** The frontend is built with `VITE_API_URL` unset, so it falls back to `http://localhost:4000`. In production the browser is not the server — localhost is the user's machine, so the request fails.
**Fix:**
1. In the **frontend** Railway service (content-creator-ai) → Variables: set `VITE_API_URL` to the **backend** Railway URL, e.g. `https://your-backend-service.up.railway.app` (no trailing slash).
2. Redeploy the frontend so the build picks up the new env var (Vite bakes `VITE_*` into the bundle at build time).
**Prevention:** Never deploy the frontend without `VITE_API_URL` set in that service's Railway variables. Document in frontend README.

#### CORS Errors (`Access-Control-Allow-Origin` missing)
**Symptom:** Browser console shows CORS error; Network tab shows no
`Access-Control-Allow-Origin` header.
**Root cause 1:** `CORS_ORIGIN` env var not set or wrong value in Railway (backend).
**Root cause 2:** Production frontend URL (e.g. https://www.videaa.com) not included in `CORS_ORIGIN`.
**Fix:** Backend uses comma-separated origins from `CORS_ORIGIN`. In Railway (backend) → Variables set:
`CORS_ORIGIN=https://www.videaa.com,https://videaa.com,http://localhost:5173`
No trailing slashes. Ensure the exact origin the browser sends is in the list (including www vs non-www).

#### `401 Unauthorized` on Valid Token
**Symptom:** Frontend sends a valid Supabase JWT but gets 401.
**Root cause 1:** JWT has expired — Supabase tokens expire after 1 hour
  by default; the frontend session may not have refreshed.
**Root cause 2:** Backend is verifying the token against the wrong Supabase
  project (wrong `SUPABASE_URL`).
**Diagnosis:**
```bash
# Decode the JWT (it's base64) to check expiry
echo "PASTE_TOKEN_HERE" | cut -d. -f2 | base64 -d | python3 -m json.tool
# Look at "exp" field — is it in the past?
```
**Fix:**
- If expired: fix the frontend to refresh session before API calls
- If wrong project: check `SUPABASE_URL` in Railway (backend) matches the frontend's
  `VITE_SUPABASE_URL` (set in the frontend Railway service)

#### RLS Blocking Service Role Queries
**Symptom:** Backend queries return empty arrays or 406 errors despite
data existing in Supabase.
**Root cause:** Backend is using the **anon key** instead of the
**service role key** for DB operations.
**Fix:**
```ts
// backend/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Use SERVICE ROLE key — bypasses RLS for trusted backend operations
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // ← Not SUPABASE_KEY
);
```
Verify in Railway variables: `SUPABASE_SERVICE_ROLE_KEY` is set and is the
service role key (starts with `eyJ`, longer than the anon key).

---

### 🔵 AI PIPELINE BUGS

#### OpenAI Returns Non-JSON Response
**Symptom:** Screenplay generation fails with `JSON.parse` error; Railway
logs show malformed AI response.
**Root cause:** OpenAI returned text with markdown code fences (```json...```)
or an explanatory preamble instead of pure JSON.
**Fix:**
```ts
function extractJson(raw: string): string {
  // Strip markdown code fences if present
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  // Strip any text before the first { or [
  const jsonStart = raw.search(/[{[]/);
  if (jsonStart > 0) return raw.slice(jsonStart);
  return raw;
}

// Always use response_format: { type: 'json_object' } to enforce JSON output
const response = await openai.chat.completions.create({
  model,
  messages,
  response_format: { type: 'json_object' },  // ← Forces JSON output
});
```
**Prevention:** Always use `response_format: { type: 'json_object' }` for
structured output. Always run `extractJson()` before `JSON.parse()`.

#### OpenAI Timeout (60s+)
**Symptom:** Screenplay generation hangs; Railway logs show timeout error
after 60+ seconds; project stuck in `processing` status.
**Root cause:** Large documents sending too many tokens; complex prompts
taking too long.
**Fix:**
```ts
// 1. Truncate input — never send more than 15,000 chars of source text
const SAFE_INPUT_LIMIT = 15_000;
const truncatedText = sourceText.slice(0, SAFE_INPUT_LIMIT);

// 2. Set explicit timeout
const response = await openai.chat.completions.create({
  model,
  messages,
  timeout: 55_000,  // 55s — gives room before Railway's 60s timeout
});

// 3. Always update project to 'failed' if timeout
try {
  const screenplay = await callOpenAIWithRetry(messages, model);
} catch (err) {
  await supabase.from('projects').update({
    status: 'failed',
    updated_at: new Date().toISOString(),
  }).eq('id', projectId);
  throw err;
}
```

#### Project Stuck in `processing` Status
**Symptom:** User sees "Processing..." indefinitely; project never reaches
`screenplay_complete` or `failed`.
**Root cause:** Pipeline threw an error after setting status to `processing`
but before the error handler updated status to `failed`.
**Fix pattern — wrap entire pipeline in status management:**
```ts
async function runScreenplayPipeline(projectId: string) {
  await setProjectStatus(projectId, 'processing');
  try {
    const screenplay = await generateScreenplay(projectId);
    await persistScreenplay(projectId, screenplay);
    await setProjectStatus(projectId, 'screenplay_complete');
  } catch (err) {
    await setProjectStatus(projectId, 'failed');
    // Log for debugging
    console.error(`Screenplay pipeline failed for ${projectId}:`, err);
    throw err;
  }
}
```
**Recovery for already-stuck projects:** Write a one-time SQL fix:
```sql
-- Reset stuck projects older than 10 minutes
UPDATE public.projects
SET status = 'failed', updated_at = now()
WHERE status = 'processing'
  AND updated_at < now() - INTERVAL '10 minutes';
```

#### Zod Validation Rejecting Valid AI Response
**Symptom:** AI returns valid-looking JSON but Zod throws validation error;
pipeline fails at the validation step.
**Root cause 1:** AI response has an unexpected field name (e.g., `"scene_id"`
instead of `"id"`).
**Root cause 2:** AI returns a number as a string (e.g., `"duration": "10"`
instead of `"duration": 10`).
**Fix:**
```ts
const SceneSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(v => Number(v)), // Coerce
  title: z.string().min(1),
  narration: z.string().min(1),
  visual_description: z.string().min(1),
  duration: z.union([z.number(), z.string()]).transform(v => Number(v)),
  // ... make schema lenient with coercions
});
```
Log the raw AI response before validation in development to understand
exactly what OpenAI is returning.

---

## 🔥 Production Incident Runbook

### T+0: Detect
- Railway health check alert OR user report OR frontend error spike
- Check `GET https://YOUR-APP.up.railway.app/health`

### T+2: Assess
- Is it total outage (health check failing) or partial (one endpoint)?
- Is Supabase/OpenAI having an incident?
- Did a recent deploy cause it?

### T+5: Mitigate
- **If recent deploy:** Railway → Deployments → Rollback immediately
- **If Railway sleeping:** Railway → Restart service
- **If OpenAI down:** Return graceful error to frontend; don't leave projects in `processing`
- **If missing env var:** Add it in Railway → Variables (auto-restart, ~60s)

### T+30: Root Cause & Fix
- Full debugging methodology above
- Write a fix PR with a regression test
- Update runbook if a new pattern was discovered

---

## ✅ Debug Completion Checklist

- [ ] Root cause confirmed (not just "it works now")
- [ ] Fix is minimal — no extra refactoring bundled in
- [ ] Regression test written (fails before fix, passes after)
- [ ] All `console.log` debug statements removed
- [ ] Project status updated to correct value (no stuck `processing` rows)
- [ ] Railway logs clean after fix is deployed
- [ ] GitHub issue closed with PR reference
- [ ] If production incident: post-mortem issue opened
