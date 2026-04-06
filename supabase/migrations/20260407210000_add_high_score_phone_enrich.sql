-- Optional phone scrape for high-scoring leads: fills leads.phone for manual dial only (no auto-dial).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_enriched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_enrich_in_progress boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS leads_phone_enrich_idx
  ON public.leads (lead_score DESC, updated_at)
  WHERE phone_enriched = false
    AND phone_enrich_in_progress = false
    AND lead_score IS NOT NULL
    AND enrichment_status = 'complete'
    AND scoring_status = 'complete';

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
    SELECT id
    FROM public.leads
    WHERE enrichment_status = 'complete'
      AND scoring_status = 'complete'
      AND icp_disqualification_reason IS NULL
      AND phone_enriched = false
      AND phone_enrich_in_progress = false
      AND lead_score IS NOT NULL
      AND lead_score >= p_min_score
    ORDER BY updated_at
    LIMIT p_batch
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l
  SET phone_enrich_in_progress = true, updated_at = now()
  FROM picked
  WHERE l.id = picked.id
  RETURNING l.*;
END;
$$;
