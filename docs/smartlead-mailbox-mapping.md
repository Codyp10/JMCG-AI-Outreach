# Smartlead mailbox mapping (20 accounts)

Reference for `smartlead-mapping` in the implementation plan. Replace placeholder domains and mailbox IDs from seed data with production values.

## Capacity (plan v2.1)

| Item | Value |
|------|------|
| Daily sends (90-day SAM) | 178 |
| Primary mailboxes | 18 |
| Backup (warmed) | 2 |
| Total warmed | 20 |
| Daily cap per primary | `floor(178 / 18)` = **9** |
| Secondary domains | **2** (15 + 5 mailboxes) |

## Layout

- **Domain A:** mailboxes 1–15 (primary) — example: `outbound-a.example.com`
- **Domain B:** mailboxes 16–18 (primary) + **19–20 (backup)** — example: `outbound-b.example.com`

Stagger warmup over **2–4 weeks** per mailbox. Partition campaigns in Smartlead by mailbox/domain group; align sending windows with provider and Smartlead limits.

## Database

`public.mailbox_health` holds one row per mailbox (`mailbox_id`, `domain`, `status`, `is_backup`, `daily_cap`, rates). Seed migration inserts `mb_1` … `mb_20` with placeholder emails — update `smartlead_mailbox_email` and `mailbox_id` to match Smartlead after accounts exist.

## Send path

The `send-queue` worker uses `SMARTLEAD_API_KEY` and `SMARTLEAD_DEFAULT_CAMPAIGN_ID`. Map per-mailbox campaigns in code when you outgrow a single default campaign; keep API keys server-side only.
