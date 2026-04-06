-- One handwritten_mail row per lead; queue handwritten before phone enrich (same score tier).

DELETE FROM public.channel_dispatch a
USING public.channel_dispatch b
WHERE a.ctid > b.ctid
  AND a.lead_id = b.lead_id
  AND a.channel = b.channel;

CREATE UNIQUE INDEX IF NOT EXISTS channel_dispatch_lead_channel_uidx
  ON public.channel_dispatch (lead_id, channel);

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
