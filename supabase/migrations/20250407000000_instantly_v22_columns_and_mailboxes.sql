-- v2.2: Instantly naming + mailbox scale (66 accounts, 6 backup, daily cap 10)

ALTER TABLE public.leads RENAME COLUMN smartlead_lead_id TO instantly_lead_id;
ALTER TABLE public.messages RENAME COLUMN smartlead_campaign_id TO instantly_campaign_id;
ALTER TABLE public.messages RENAME COLUMN smartlead_message_id TO instantly_email_id;
ALTER TABLE public.replies RENAME COLUMN smartlead_event_id TO instantly_event_id;
ALTER TABLE public.mailbox_health RENAME COLUMN smartlead_mailbox_email TO instantly_mailbox_email;

TRUNCATE public.mailbox_health;

INSERT INTO public.mailbox_health (
  mailbox_id,
  domain,
  status,
  is_backup,
  daily_cap,
  bounce_rate_30d,
  complaint_rate_30d,
  instantly_mailbox_email
)
SELECT
  'mb_' || g.n,
  (ARRAY[
    'outbound-a.example.com',
    'outbound-b.example.com',
    'outbound-c.example.com',
    'outbound-d.example.com',
    'outbound-e.example.com'
  ])[
    CASE
      WHEN g.n <= 14 THEN 1
      WHEN g.n <= 28 THEN 2
      WHEN g.n <= 42 THEN 3
      WHEN g.n <= 56 THEN 4
      ELSE 5
    END
  ],
  'warmup'::mailbox_status,
  g.n > 60,
  10,
  0,
  0,
  'sender' || g.n || '@' ||
  (ARRAY[
    'outbound-a.example.com',
    'outbound-b.example.com',
    'outbound-c.example.com',
    'outbound-d.example.com',
    'outbound-e.example.com'
  ])[
    CASE
      WHEN g.n <= 14 THEN 1
      WHEN g.n <= 28 THEN 2
      WHEN g.n <= 42 THEN 3
      WHEN g.n <= 56 THEN 4
      ELSE 5
    END
  ]
FROM generate_series(1, 66) AS g (n);
