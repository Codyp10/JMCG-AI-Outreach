# pg_cron → Vercel workers

Supabase `pg_cron` (or Database Webhooks) should call these endpoints with the shared secret.

## Auth

Send header **`Authorization: Bearer <CRON_SECRET>`** or **`x-cron-secret: <CRON_SECRET>`** (same value as Vercel `CRON_SECRET`).

## Endpoints (base = your Vercel deployment URL)

| Job | Method | Path |
|-----|--------|------|
| Apollo ingest (People Search → `leads`) | POST | `/api/workers/apollo-ingest` |
| Enrichment | POST | `/api/workers/waterfall-enrich` |
| Scoring | POST | `/api/workers/score` |
| Handwritten enqueue | POST | `/api/workers/handwritten-enqueue` | same tier as `HIGH_TOUCH_MIN_SCORE`; inserts `channel_dispatch` **before** phone enrich |
| Phone enrich (manual dial tier) | POST | `/api/workers/phone-enrich` | only after handwritten row exists; writes `leads.phone` — no auto-dial |
| Copy + QA | POST | `/api/workers/copy-generate` |
| Send queue | POST | `/api/workers/send-queue` |
| Cooldown re-entry | POST | `/api/workers/cooldown-reentry` |
| Monthly optimize | POST | `/api/workers/monthly-optimize` |
| Mailbox health | POST | `/api/workers/mailbox-health` or `/api/workers/mailbox-health-check` |
| Smoke test | POST | `/api/cron-receiver` |

**Reply agent (Instantly `reply_received` webhook):** `POST /api/workers/reply-agent` — register the webhook with **`Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>`** (see `verifyInstantlyWebhook` in `src/lib/workers/cron-auth.ts`).

## Storing `CRON_SECRET` in Supabase Vault

A secret named **`vercel_cron_secret`** can hold the same value as Vercel’s **`CRON_SECRET`**. In SQL (run once if you manage secrets yourself):

```sql
SELECT vault.create_secret(
  'YOUR_HEX_SECRET'::text,
  'vercel_cron_secret'::text,
  'Bearer token for Vercel worker POSTs'::text,
  NULL::uuid
);
```

Read it when calling workers (must match Vercel env exactly):

```sql
SELECT decrypted_secret
FROM vault.decrypted_secrets
WHERE name = 'vercel_cron_secret'
LIMIT 1;
```

## Example (`pg_net` / `net.http_post`)

Enable **pg_net** (and **pg_cron**) in Supabase if not already. Use your real Vercel URL:

```sql
SELECT net.http_post(
  url := 'https://YOUR_PROJECT.vercel.app/api/workers/waterfall-enrich',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'vercel_cron_secret'
      LIMIT 1
    )
  ),
  body := '{}'::jsonb
);
```

Configure schedules per plan (e.g. enrich every 10 min, send every 2 min). Use **Vercel Pro** for **300s** timeouts on worker routes.

**Order:** Run **`handwritten-enqueue` before `phone-enrich`** (same cron interval is fine if handwritten runs first — e.g. two `net.http_post` calls in one pg_cron job, or schedule handwritten a few minutes earlier).

---

## Apollo ingest (scheduled in repo migration)

Migration **`20260410120000_pg_cron_apollo_ingest.sql`** creates:

- Table **`public.cron_target`** (singleton `id = 1`) with **`vercel_base_url`** — default **`https://jmcg-ai-outreach.vercel.app`**. If your Vercel URL differs, run:

```sql
UPDATE public.cron_target
SET vercel_base_url = 'https://YOUR-ACTUAL-PROJECT.vercel.app'
WHERE id = 1;
```

- Function **`public.invoke_apollo_ingest()`** — `POST` **`{vercel_base_url}/api/workers/apollo-ingest`** with **`Authorization: Bearer`** + **`vault.decrypted_secrets`** where **`name = 'vercel_cron_secret'`** (same value as Vercel **`CRON_SECRET`**).

- pg_cron job **`jmcg-apollo-ingest`** — **`20 * * * *`** (every hour at :20). Change the schedule in SQL with `cron.unschedule` / `cron.schedule` if needed.

**Full URL called (default):** `https://jmcg-ai-outreach.vercel.app/api/workers/apollo-ingest`

Requires **Vault** secret **`vercel_cron_secret`** and extensions **pg_cron** + **pg_net** enabled in the Supabase project.
