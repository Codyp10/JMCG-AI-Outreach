-- Singleton row (id = 1): default Instantly campaign UUID and future integration defaults.
-- send-queue reads instantly_default_campaign_id before falling back to INSTANTLY_DEFAULT_CAMPAIGN_ID env.

CREATE TABLE public.integration_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  CONSTRAINT integration_settings_singleton CHECK (id = 1),
  instantly_default_campaign_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.integration_settings IS 'Singleton id=1. When instantly_default_campaign_id is set, send-queue uses it instead of env INSTANTLY_DEFAULT_CAMPAIGN_ID.';

INSERT INTO public.integration_settings (id) VALUES (1);

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;
