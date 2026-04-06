# JMCG AI Outreach

Next.js app on **Vercel** with Supabase-backed workers (enrichment, scoring, copy, send queue, handwritten enqueue, phone enrich, reply agent). See `docs/jmcg-ai-outreach-plan.md` for the full blueprint.

## Requirements

- **Vercel Pro** — worker routes use **300s** `maxDuration` (`vercel.json`). Hobby’s 60s limit is not enough for batch workers.
- **Supabase** — apply migrations under `supabase/migrations/` to the same project whose URL and service role key you set in Vercel.
- **Node.js** — LTS (e.g. 20.x) for local builds.

## 1. Deploy on Vercel Pro

1. Push this repo to GitHub (or GitLab / Bitbucket) if it is not already remote.
2. In [Vercel](https://vercel.com/new), **Add New Project** → import the repo.
3. **Framework preset:** Next.js (auto-detected). **Root directory:** repo root.
4. **Plan:** upgrade the project to **Pro** so serverless functions can run up to **300s** on the paths defined in `vercel.json`.
5. Deploy once (build may succeed before env vars are set; workers will 401 or error until secrets are added).

If workers feel slow, set a **single Vercel region** near your Supabase region (**Project Settings → Infrastructure → Region** in Vercel).

## 2. Environment variables (Vercel)

**Where:** Project → **Settings** → **Environment Variables**.

- Enable **Production** for each name you use in prod (and **Preview** only if you want preview deployments to call a *staging* Supabase — otherwise omit Preview to avoid accidental writes).
- Mark secrets as **Sensitive** when Vercel offers it.
- Names must match **exactly** (case-sensitive). No quotes around values in the UI.
- After any change: **Deployments** → open latest → **⋯** → **Redeploy** (or push a commit) so running functions pick up new values.

### Phase A — set these first (pipeline + cron)

These three connect Vercel to **the same Supabase project** you migrated (URL + **service_role** key, not `anon`):

| Name | Where to get it |
|------|------------------|
| `SUPABASE_URL` | Supabase dashboard → **Project Settings** → **API** → **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **Project API keys** → **service_role** (reveal / copy) |
| `CRON_SECRET` | **You create this** — it is not issued by Supabase or Vercel. Generate a long random secret (e.g. run `openssl rand -hex 32` in a terminal, or use a password manager). Paste the **same** value into Vercel and into whatever calls your workers (`Authorization: Bearer <CRON_SECRET>`), e.g. Supabase `pg_cron` or an external scheduler. |

With only Phase A, routes that use **`getFullEnv()`** still need `CRON_SECRET` to be valid (min **8** characters in code). Workers that talk to Supabase need the two `SUPABASE_*` variables.

### Phase B — when you turn on real email + AI copy

| Name | Purpose |
|------|---------|
| `GEMINI_API_KEY` | **Google Gemini** (AI Studio) — copy + QA in `copy-generate`; reply classification in `reply-agent`. Without it, `copy-generate` uses a short template fallback. |
| `GEMINI_MODEL` | Optional — defaults to **`gemini-2.5-flash`**. Change when you want a different Gemini model ID. |
| `INSTANTLY_API_KEY` | **Instantly API v2** — Bearer token for `send-queue`. |
| `INSTANTLY_DEFAULT_CAMPAIGN_ID` | Instantly campaign UUID leads are added to from `send-queue`. |

### Phase C — webhooks and ops

| Name | Purpose |
|------|---------|
| `INSTANTLY_WEBHOOK_SECRET` | Shared secret Instantly sends (e.g. `Authorization: Bearer …`) so **`/api/workers/reply-agent`** accepts webhooks. **Not** the same string as `INSTANTLY_API_KEY`. |
| `SLACK_WEBHOOK_URL` | Optional — escalations / monthly summary where implemented. |

### Phase D — enrichment (optional until vendors are wired)

| Name | Purpose |
|------|---------|
| `ENRICHMENT_CLAY_API_KEY` | Waterfall / enrichment (when implemented). |
| `ENRICHMENT_LEADMAGIC_API_KEY` | Same. |
| `ENRICHMENT_HUNTER_API_KEY` | Same. |
| `MAX_ENRICHMENT_COST_PER_LEAD` | Defaults to **0.15** in code if unset. |

### Other

- **`GEO_ALLOWLIST`** (optional) — comma or newline separated; used by **`/api/workers/score`** for geo points in the HVAC rubric.

Full list of names is in **`.env.example`**.

## 3. Sanity checks

- **App:** open `https://<your-project>.vercel.app/` — home page should load.
- **Cron auth:** `GET https://<your-project>.vercel.app/api/cron-receiver` → `{ "ok": true, ... }`.
- **Cron secret:** `POST` the same URL with header `Authorization: Bearer <CRON_SECRET>` → `{ "authenticated": true }` (see `docs/pg-cron-vercel.md`).

## 4. Next (outside this repo)

- Point **Supabase `pg_cron`** (or another scheduler) at your production URLs with `CRON_SECRET`.
- Register **Instantly** webhooks to `https://<your-project>.vercel.app/api/workers/reply-agent` (and mailbox routes per your plan).

## Local development

```bash
npm install
cp .env.example .env.local
# Fill .env.local — use the same variable names as Vercel
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Worker routes are under `/api/workers/*` and expect the cron secret when called with `POST`.
