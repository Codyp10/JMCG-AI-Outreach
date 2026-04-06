-- JMCG AI Outreach — core schema (v2.1)
-- Run via Supabase CLI or SQL editor.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE enrichment_status AS ENUM ('pending', 'in_progress', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE scoring_status AS ENUM ('pending', 'in_progress', 'complete', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sequence_status AS ENUM ('active', 'completed', 'paused', 'cooldown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_status AS ENUM (
    'draft',
    'qa_pending',
    'qa_pass',
    'queued',
    'sent',
    'failed',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE qa_verdict AS ENUM ('pass', 'regenerate', 'failed_qa');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reply_classification AS ENUM (
    'out_of_office',
    'automated',
    'negative',
    'neutral',
    'positive',
    'meeting_booked',
    'unclassified'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mailbox_status AS ENUM ('active', 'warmup', 'paused', 'backup');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE channel_type AS ENUM ('email', 'handwritten_mail');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE channel_dispatch_status AS ENUM ('pending', 'scheduled', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_email text,
  first_name text,
  last_name text,
  title text,
  company_name text,
  industry text,
  location text,
  geo text,
  phone text,
  linkedin_url text,
  signals_json jsonb DEFAULT '{}'::jsonb,
  verified_facts_json jsonb DEFAULT '{}'::jsonb,
  smartlead_lead_id text,
  enrichment_status enrichment_status NOT NULL DEFAULT 'pending',
  scoring_status scoring_status NOT NULL DEFAULT 'pending',
  lead_score smallint CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)),
  channel_flags jsonb DEFAULT '{"email": true, "handwritten_mail": false}'::jsonb,
  cycle_number integer NOT NULL DEFAULT 1,
  previous_library_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  icp_vertical text NOT NULL DEFAULT 'hvac',
  google_review_count integer,
  has_active_hvac_hiring boolean,
  runs_google_lsa_or_ppc boolean,
  runs_meta_ads boolean,
  paid_ads_signals jsonb,
  fsm_software text,
  icp_disqualification_reason text,
  enrichment_error text,
  scoring_error text,
  phone_enriched boolean NOT NULL DEFAULT false,
  phone_enrich_in_progress boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_enrichment_pending_idx
  ON public.leads (created_at)
  WHERE enrichment_status = 'pending' AND icp_disqualification_reason IS NULL;

CREATE INDEX leads_scoring_pending_idx
  ON public.leads (updated_at)
  WHERE enrichment_status = 'complete' AND scoring_status = 'pending';

CREATE INDEX leads_phone_enrich_idx
  ON public.leads (lead_score DESC, updated_at)
  WHERE phone_enriched = false
    AND phone_enrich_in_progress = false
    AND lead_score IS NOT NULL
    AND enrichment_status = 'complete'
    AND scoring_status = 'complete';

-- ---------------------------------------------------------------------------
-- Enrichment runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  provider_order text NOT NULL,
  status text NOT NULL DEFAULT 'complete',
  payload jsonb,
  cost numeric(12, 4) NOT NULL DEFAULT 0,
  cumulative_cost numeric(12, 4) NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enrichment_runs_lead_id_idx ON public.enrichment_runs (lead_id);

-- ---------------------------------------------------------------------------
-- Scores (history / audit)
-- ---------------------------------------------------------------------------
CREATE TABLE public.scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  total_score smallint NOT NULL CHECK (total_score >= 0 AND total_score <= 100),
  rubric_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scores_lead_id_idx ON public.scores (lead_id);

-- ---------------------------------------------------------------------------
-- Experiments / variants
-- ---------------------------------------------------------------------------
CREATE TABLE public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  variant_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, variant_key)
);

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------
CREATE TABLE public.sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  experiment_id uuid REFERENCES public.experiments (id) ON DELETE SET NULL,
  status sequence_status NOT NULL DEFAULT 'active',
  max_touches smallint NOT NULL DEFAULT 4 CHECK (max_touches >= 1 AND max_touches <= 7),
  next_touch_index smallint NOT NULL DEFAULT 1 CHECK (next_touch_index >= 1),
  variant_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sequences_active_copy_idx
  ON public.sequences (updated_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Leverage library
-- ---------------------------------------------------------------------------
CREATE TABLE public.leverage_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  industry_tags text[] NOT NULL DEFAULT '{}',
  persona_tags text[] NOT NULL DEFAULT '{}',
  problem text NOT NULL,
  approach text NOT NULL,
  metrics text NOT NULL,
  quote_snippet text,
  constraints text,
  geo text,
  company_archetype text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leverage_library_industry_gin ON public.leverage_library USING gin (industry_tags);
CREATE INDEX leverage_library_persona_gin ON public.leverage_library USING gin (persona_tags);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.sequences (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  touch_index smallint NOT NULL CHECK (touch_index >= 1),
  experiment_variant text,
  subject text,
  body text,
  status message_status NOT NULL DEFAULT 'draft',
  library_entry_id uuid REFERENCES public.leverage_library (id) ON DELETE SET NULL,
  smartlead_campaign_id text,
  smartlead_message_id text,
  regeneration_attempt smallint NOT NULL DEFAULT 0 CHECK (regeneration_attempt >= 0 AND regeneration_attempt <= 5),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, touch_index)
);

CREATE INDEX messages_send_queue_idx
  ON public.messages (created_at)
  WHERE status = 'qa_pass';

-- ---------------------------------------------------------------------------
-- QA results
-- ---------------------------------------------------------------------------
CREATE TABLE public.qa_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  verdict qa_verdict NOT NULL,
  regeneration_attempt smallint NOT NULL DEFAULT 1 CHECK (regeneration_attempt >= 1 AND regeneration_attempt <= 3),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX qa_results_message_id_idx ON public.qa_results (message_id);

-- ---------------------------------------------------------------------------
-- Replies
-- ---------------------------------------------------------------------------
CREATE TABLE public.replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages (id) ON DELETE SET NULL,
  inbound_body text,
  from_address text,
  smartlead_event_id text UNIQUE,
  reply_classification reply_classification NOT NULL DEFAULT 'unclassified',
  counts_as_positive_reply boolean NOT NULL DEFAULT false,
  classification_confidence numeric(5, 4),
  classification_override boolean NOT NULL DEFAULT false,
  escalation_reason text,
  agent_response_body text,
  thread_position smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX replies_lead_id_idx ON public.replies (lead_id);

-- ---------------------------------------------------------------------------
-- Cooldown queue
-- ---------------------------------------------------------------------------
CREATE TABLE public.cooldown_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  cooldown_until timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id)
);

-- Partial predicate cannot use now() (not IMMUTABLE); index by due time for cron scans.
CREATE INDEX cooldown_queue_due_idx ON public.cooldown_queue (cooldown_until);

-- ---------------------------------------------------------------------------
-- Channel dispatch (handwritten mail — compliance-gated in app layer)
-- ---------------------------------------------------------------------------
CREATE TABLE public.channel_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  channel channel_type NOT NULL,
  status channel_dispatch_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz,
  vendor_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_dispatch_lead_idx ON public.channel_dispatch (lead_id);

CREATE UNIQUE INDEX channel_dispatch_lead_channel_uidx
  ON public.channel_dispatch (lead_id, channel);

-- ---------------------------------------------------------------------------
-- Optimization log
-- ---------------------------------------------------------------------------
CREATE TABLE public.optimization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_date date NOT NULL,
  change_type text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  data_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_override boolean NOT NULL DEFAULT false,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX optimization_log_cycle_idx ON public.optimization_log (cycle_date DESC);

-- ---------------------------------------------------------------------------
-- Mailbox health
-- ---------------------------------------------------------------------------
CREATE TABLE public.mailbox_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id text NOT NULL UNIQUE,
  domain text NOT NULL,
  status mailbox_status NOT NULL DEFAULT 'warmup',
  is_backup boolean NOT NULL DEFAULT false,
  daily_cap integer,
  bounce_rate_30d numeric(6, 4),
  complaint_rate_30d numeric(6, 4),
  last_health_check timestamptz,
  pause_reason text,
  smartlead_mailbox_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Worker runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  batch_size integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_details jsonb
);

CREATE INDEX worker_runs_worker_started_idx ON public.worker_runs (worker_name, started_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER sequences_updated_at
  BEFORE UPDATE ON public.sequences
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER leverage_library_updated_at
  BEFORE UPDATE ON public.leverage_library
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER channel_dispatch_updated_at
  BEFORE UPDATE ON public.channel_dispatch
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER mailbox_health_updated_at
  BEFORE UPDATE ON public.mailbox_health
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic batch claims (idempotent workers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_leads_for_enrichment(p_batch integer)
RETURNS SETOF public.leads
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.leads
    WHERE enrichment_status = 'pending'
      AND icp_disqualification_reason IS NULL
    ORDER BY created_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l
  SET enrichment_status = 'in_progress'
  FROM picked
  WHERE l.id = picked.id
  RETURNING l.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_leads_for_scoring(p_batch integer)
RETURNS SETOF public.leads
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.leads
    WHERE enrichment_status = 'complete'
      AND scoring_status = 'pending'
      AND icp_disqualification_reason IS NULL
    ORDER BY updated_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l
  SET scoring_status = 'in_progress'
  FROM picked
  WHERE l.id = picked.id
  RETURNING l.*;
END;
$$;

-- Queue handwritten fulfillment first; phone enrich runs only after dispatch exists (manual dial only).
CREATE OR REPLACE FUNCTION public.enqueue_handwritten_mail_dispatch(
  p_batch integer,
  p_min_score smallint
)
RETURNS SETOF uuid
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT l.id
    FROM public.leads l
    WHERE l.enrichment_status = 'complete'
      AND l.scoring_status = 'complete'
      AND l.icp_disqualification_reason IS NULL
      AND l.lead_score IS NOT NULL
      AND l.lead_score >= p_min_score
      AND COALESCE((l.channel_flags->>'handwritten_mail')::boolean, false) = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.channel_dispatch cd
        WHERE cd.lead_id = l.id
          AND cd.channel = 'handwritten_mail'::public.channel_type
      )
    ORDER BY l.updated_at
    LIMIT p_batch
    FOR UPDATE OF l SKIP LOCKED
  ),
  ins AS (
    INSERT INTO public.channel_dispatch (lead_id, channel, status)
    SELECT p.id, 'handwritten_mail'::public.channel_type, 'pending'::public.channel_dispatch_status
    FROM picked p
    RETURNING lead_id
  )
  SELECT lead_id FROM ins;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_leads_for_phone_enrich(
  p_batch integer,
  p_min_score smallint
)
RETURNS SETOF public.leads
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT l.id
    FROM public.leads l
    INNER JOIN public.channel_dispatch cd ON cd.lead_id = l.id
      AND cd.channel = 'handwritten_mail'::public.channel_type
      AND cd.status IN (
        'pending'::public.channel_dispatch_status,
        'scheduled'::public.channel_dispatch_status,
        'sent'::public.channel_dispatch_status
      )
    WHERE l.enrichment_status = 'complete'
      AND l.scoring_status = 'complete'
      AND l.icp_disqualification_reason IS NULL
      AND l.phone_enriched = false
      AND l.phone_enrich_in_progress = false
      AND l.lead_score IS NOT NULL
      AND l.lead_score >= p_min_score
    ORDER BY l.updated_at
    LIMIT p_batch
    FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE public.leads l
  SET phone_enrich_in_progress = true, updated_at = now()
  FROM picked
  WHERE l.id = picked.id
  RETURNING l.*;
END;
$$;

-- Sequences ready for copy: active, lead scored, no blocking message for next_touch_index
CREATE OR REPLACE FUNCTION public.claim_sequences_for_copy(p_batch integer)
RETURNS TABLE (
  sequence_id uuid,
  lead_id uuid,
  touch_index smallint,
  max_touches smallint,
  experiment_id uuid,
  variant_key text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id,
           s.lead_id,
           s.next_touch_index,
           s.max_touches,
           s.experiment_id,
           s.variant_key
    FROM public.sequences s
    INNER JOIN public.leads l ON l.id = s.lead_id
    WHERE s.status = 'active'
      AND l.scoring_status = 'complete'
      AND l.icp_disqualification_reason IS NULL
      AND s.next_touch_index <= s.max_touches
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.sequence_id = s.id
          AND m.touch_index = s.next_touch_index
          AND m.status IN ('qa_pending', 'qa_pass', 'queued', 'sent', 'skipped')
      )
    ORDER BY s.updated_at
    LIMIT p_batch
    FOR UPDATE OF s SKIP LOCKED
  ),
  touched AS (
    UPDATE public.sequences s
    SET updated_at = now()
    FROM candidates c
    WHERE s.id = c.id
    RETURNING
      s.id AS sequence_id,
      s.lead_id,
      s.next_touch_index AS touch_index,
      s.max_touches,
      s.experiment_id,
      s.variant_key
  )
  SELECT * FROM touched;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_messages_for_send(p_batch integer)
RETURNS SETOF public.messages
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.messages
    WHERE status = 'qa_pass'
    ORDER BY updated_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.messages m
  SET status = 'queued', updated_at = now()
  FROM picked
  WHERE m.id = picked.id
  RETURNING m.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cooldown_leads(p_batch integer)
RETURNS SETOF public.cooldown_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT cq.id
    FROM public.cooldown_queue cq
    WHERE cq.cooldown_until <= now()
    ORDER BY cq.cooldown_until
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  ),
  deleted AS (
    DELETE FROM public.cooldown_queue d
    WHERE d.id IN (SELECT id FROM picked)
    RETURNING *
  )
  SELECT * FROM deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (service role bypasses; block anon until dashboard policies)
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leverage_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooldown_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimization_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mailbox_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.channel_dispatch IS
  'Handwritten mail (and similar). Do not activate until compliance-review is cleared; no calls, voicemail, SMS, or WhatsApp.';
