# pg_cron → Vercel workers

Supabase `pg_cron` (or Database Webhooks) should call these endpoints with the shared secret.

## Auth

Send header **`Authorization: Bearer <CRON_SECRET>`** or **`x-cron-secret: <CRON_SECRET>`** (same value as Vercel `CRON_SECRET`).

## Endpoints (base = your Vercel deployment URL)

| Job | Method | Path |
|-----|--------|------|
| Enrichment | POST | `/api/workers/waterfall-enrich` |
| Scoring | POST | `/api/workers/score` |
| Phone enrich | POST | `/api/workers/phone-enrich` |
| Copy + QA | POST | `/api/workers/copy-generate` |
| Send queue | POST | `/api/workers/send-queue` |
| Cooldown re-entry | POST | `/api/workers/cooldown-reentry` |
| Monthly optimize | POST | `/api/workers/monthly-optimize` |
| Mailbox health | POST | `/api/workers/mailbox-health` or `/api/workers/mailbox-health-check` |
| Smoke test | POST | `/api/cron-receiver` |

**Reply agent (Instantly `reply_received` webhook):** `POST /api/workers/reply-agent` — register the webhook with **`Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>`** (see `verifyInstantlyWebhook` in `src/lib/workers/cron-auth.ts`).

## Example (HTTP extension)

```sql
-- Illustrative only — use your project URL and store the secret in Vault / settings.
SELECT net.http_post(
  url := 'https://YOUR_PROJECT.vercel.app/api/workers/waterfall-enrich',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
  ),
  body := '{}'::jsonb
);
```

Configure schedules per plan (e.g. enrich every 10 min, send every 2 min). Use **Vercel Pro** for **300s** timeouts on worker routes.
