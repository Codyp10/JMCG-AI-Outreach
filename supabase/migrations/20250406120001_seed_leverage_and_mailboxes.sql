-- Seed: Leverage Library (HVAC) + mailbox placeholders (20 rows; superseded by 20250407000000 for v2.2 scale)
-- Replace mailbox_id / emails with real Instantly values in production.

INSERT INTO public.leverage_library (
  title,
  industry_tags,
  persona_tags,
  problem,
  approach,
  metrics,
  quote_snippet,
  constraints,
  geo,
  company_archetype
) VALUES
(
  'Independent HVAC — LSA + review growth',
  ARRAY['hvac', 'residential_hvac'],
  ARRAY['owner', 'gm', 'marketing'],
  'Seasonal demand swings and rising CPC on local search made it hard to keep techs booked without overspending.',
  'Tightened Google LSA/PPC structure, built a review cadence tied to ServiceTitan job closes, and aligned landing pages to service-area intent.',
  'Cost per booked lead down 22% in 90 days; review velocity +38%; call answer rate improved with scripted dispatch prompts.',
  'Independent operator; single-location; residential-heavy mix.',
  NULL,
  'US regional',
  'independent_owner_operator'
),
(
  'Owner-led HVAC — dispatch + CRM reporting',
  ARRAY['hvac', 'residential_hvac'],
  ARRAY['owner', 'operations'],
  'Marketing spend looked fine in-platform but revenue per tech hour was flat — reporting between ads and CRM was disconnected.',
  'Mapped campaigns to ServiceTitan campaign tags, built weekly owner dashboard (spend → booked jobs → revenue), reallocated budget to top ZIPs.',
  'Revenue per tech hour +12% over one season; wasted spend in two underperforming ZIPs eliminated.',
  'Requires ServiceTitan or comparable tagging discipline.',
  NULL,
  'US regional',
  'independent_owner_operator'
);

-- 18 primary + 2 backup mailboxes (placeholders — domain A + domain B per plan)
INSERT INTO public.mailbox_health (
  mailbox_id,
  domain,
  status,
  is_backup,
  daily_cap,
  bounce_rate_30d,
  complaint_rate_30d,
  smartlead_mailbox_email
)
SELECT
  'mb_' || g.n,
  CASE WHEN g.n <= 15 THEN 'outbound-a.example.com' ELSE 'outbound-b.example.com' END,
  'warmup'::mailbox_status,
  g.n > 18,
  9,
  0,
  0,
  'sender' || g.n || '@' ||
    CASE WHEN g.n <= 15 THEN 'outbound-a.example.com' ELSE 'outbound-b.example.com' END
FROM generate_series(1, 20) AS g (n);
