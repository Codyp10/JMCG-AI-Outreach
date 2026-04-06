# Instantly mailbox mapping (66 accounts)

Reference for `instantly-setup` in the implementation plan. Replace placeholder domains and mailbox IDs from seed data with production values.

## Capacity (plan v2.2)

| Item | Value |
|------|------|
| New leads/day (ingest) | 178 |
| Total email volume (steady state) | ~600/day |
| Primary mailboxes | 60 |
| Backup (warmed) | 6 |
| Total accounts | 66 |
| Secondary domains | **5** |
| Daily cap per primary (nominal) | **10** (`floor(600 / 60)`) |

## Layout

Seed migration `20250407000000_instantly_v22_columns_and_mailboxes.sql` distributes **mb_1**–**mb_66** across **outbound-a** … **outbound-e** placeholder domains; **mb_61**–**mb_66** are backups (`is_backup = true`). **Instantly** includes **unlimited warmup** on paid plans; optional **~$7/mo** pre-warmed accounts reduce ramp time.

## Database

`public.mailbox_health` holds one row per mailbox (`mailbox_id`, `domain`, `status`, `is_backup`, `daily_cap`, rates). Update `instantly_mailbox_email` and `mailbox_id` to match Instantly after accounts exist.

## Send path

The `send-queue` worker uses **`INSTANTLY_API_KEY`** and **`INSTANTLY_DEFAULT_CAMPAIGN_ID`**, calling **Instantly API v2** `POST /api/v2/leads/add`. Sequence copy lives in the Instantly campaign; `personalization` on each lead can carry subject/body context for template variables. Map per-mailbox campaigns in code when you outgrow a single default; keep API keys server-side only.

## Webhooks

Register **`reply_received`** and **`email_bounced`** (and others as needed) with auth header **`Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>`** per [Instantly webhook docs](https://developer.instantly.ai/).
