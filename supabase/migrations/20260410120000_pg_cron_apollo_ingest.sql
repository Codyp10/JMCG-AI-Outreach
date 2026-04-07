-- pg_cron → Vercel POST /api/workers/apollo-ingest (hourly).
-- Requires: pg_cron + pg_net enabled in Supabase; vault secret `vercel_cron_secret` = same value as Vercel CRON_SECRET.
-- Default Vercel host matches package name; change with: UPDATE public.cron_target SET vercel_base_url = 'https://YOUR_HOST' WHERE id = 1;

CREATE TABLE IF NOT EXISTS public.cron_target (
  id smallint PRIMARY KEY CHECK (id = 1),
  vercel_base_url text NOT NULL
);

COMMENT ON TABLE public.cron_target IS 'Singleton id=1: Vercel deployment origin (no trailing slash), used by pg_cron HTTP workers.';

INSERT INTO public.cron_target (id, vercel_base_url)
VALUES (1, 'https://jmcg-ai-outreach.vercel.app')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cron_target ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.invoke_apollo_ingest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $$
DECLARE
  base text;
  tok text;
BEGIN
  SELECT trim(both '"' FROM decrypted_secret::text) INTO tok
  FROM vault.decrypted_secrets
  WHERE name = 'vercel_cron_secret'
  LIMIT 1;

  IF tok IS NULL OR tok = '' THEN
    RAISE WARNING 'apollo-ingest: vault secret vercel_cron_secret missing or empty';
    RETURN;
  END IF;

  SELECT vercel_base_url INTO base FROM public.cron_target WHERE id = 1;
  IF base IS NULL OR base = '' THEN
    RAISE WARNING 'apollo-ingest: cron_target.vercel_base_url missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(base, '/') || '/api/workers/apollo-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || tok
    ),
    body := '{}'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.invoke_apollo_ingest() IS 'Called by pg_cron job jmcg-apollo-ingest; POSTs Apollo ingest worker on Vercel.';

DO $$
BEGIN
  PERFORM cron.unschedule('jmcg-apollo-ingest');
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN others THEN NULL;
END
$$;

SELECT cron.schedule(
  'jmcg-apollo-ingest',
  '20 * * * *',
  $cron$SELECT public.invoke_apollo_ingest();$cron$
);
