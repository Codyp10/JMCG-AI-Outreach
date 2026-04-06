-- Email + handwritten mail only: remove voicemail channel, voice consent fields,
-- and the score-gated phone-enrichment pipeline (was for ringless voicemail).

DROP INDEX IF EXISTS public.leads_phone_enrich_idx;
DROP FUNCTION IF EXISTS public.claim_leads_for_phone_enrich(integer);

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS voice_consent,
  DROP COLUMN IF EXISTS consent_source,
  DROP COLUMN IF EXISTS consent_date,
  DROP COLUMN IF EXISTS phone_enriched,
  DROP COLUMN IF EXISTS phone_enrich_in_progress;

DELETE FROM public.channel_dispatch WHERE channel::text = 'voicemail_drop';

ALTER TABLE public.channel_dispatch
  ALTER COLUMN channel TYPE text USING channel::text;

DROP TYPE public.channel_type;

CREATE TYPE public.channel_type AS ENUM ('email', 'handwritten_mail');

ALTER TABLE public.channel_dispatch
  ALTER COLUMN channel TYPE public.channel_type USING channel::public.channel_type;

COMMENT ON TABLE public.channel_dispatch IS
  'Handwritten mail (and similar) via fulfillment vendor. Compliance-gated in app layer; no calls, voicemail, SMS, or WhatsApp.';

UPDATE public.leads SET channel_flags = (channel_flags - 'voicemail_drop');

ALTER TABLE public.leads
  ALTER COLUMN channel_flags SET DEFAULT '{"email": true, "handwritten_mail": false}'::jsonb;
