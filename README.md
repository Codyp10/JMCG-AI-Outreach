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
| `GEMINI_API_KEY` | **Google Gemini** (AI Studio) — copy + QA in `copy-generate`; reply classification in `reply-agent`. Without it, `copy-generate` uses a short template fallback and replies stay `unclassified` unless you classify another way. |
| `GEMINI_MODEL` | Optional — defaults to **`gemini-2.5-flash`** (see `DEFAULT_GEMINI_MODEL` in `src/lib/gemini/generate.ts`). Set only if you want another model ID from Google’s API. |
| `INSTANTLY_API_KEY` | **Instantly API v2** — Bearer token for `send-queue`. |
| `INSTANTLY_DEFAULT_CAMPAIGN_ID` | Optional fallback — Instantly campaign UUID for `send-queue`. **Preferred:** store the default campaign in Supabase **`integration_settings`** (singleton row `id = 1`, column `instantly_default_campaign_id`); apply migration `20260408130000_integration_settings.sql` if the table is missing. When that column is non-empty, it overrides this env var. |

#### Gemini setup (Vercel)

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and **Create API key** (pick or create a Google Cloud project if prompted).
2. In Vercel → your project → **Settings** → **Environment Variables**, add **`GEMINI_API_KEY`** (Production; Preview only if you want AI on preview deploys). Mark it sensitive.
3. Optional: add **`GEMINI_MODEL`** if you are not using the default Flash model.
4. **Redeploy** the latest deployment (or push a commit) so serverless functions load the new variables.
5. **Verify:** after the next `copy-generate` cron run, new `qa_results.details` rows should show `"mode":"gemini"` for messages that used AI (see `copy-generate` worker). Inbound **`reply-agent`** webhooks should persist non-`unclassified` labels when the inbound body is non-empty and Gemini succeeds.

#### Default Instantly campaign in Supabase

After migration, set the UUID once (SQL editor or any admin client):

```sql
UPDATE public.integration_settings
SET instantly_default_campaign_id = 'YOUR_INSTANTLY_CAMPAIGN_UUID'
WHERE id = 1;
```

You can leave **`INSTANTLY_DEFAULT_CAMPAIGN_ID`** unset in Vercel if this column is set.

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
