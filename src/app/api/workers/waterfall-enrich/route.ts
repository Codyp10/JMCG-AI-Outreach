import { NextResponse } from "next/server";
import { hunterDomainSearchBestEmail } from "@/lib/integrations/hunter";
import {
  computeEnrichmentDelta,
  ENRICHABLE_LEAD_SCALAR_KEYS,
  mergeSignalsJson,
} from "@/lib/leads/enrichment-merge";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 20;

function readOrganizationDomainForHunter(signals: unknown): string | null {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    return null;
  }
  const o = signals as Record<string, unknown>;
  const org = o.organization_domain;
  if (typeof org === "string" && org.trim() !== "") return org.trim();
  const legacy = o.clay_company_domain;
  if (typeof legacy === "string" && legacy.trim() !== "") return legacy.trim();
  return null;
}

function isEmptyWorkEmail(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const env = getFullEnv();
  const runId = await startWorkerRun(supabase, "waterfall-enrich");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_leads_for_enrichment",
      { p_batch: BATCH },
    );

    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as Record<string, unknown>[];
    batch = rows.length;

    for (const lead of rows) {
      const id = String(lead.id);
      try {
        const patch: Record<string, unknown> = {};
        let cumulative = 0;
        const payload: Record<string, unknown> = {
          phase: "post_apollo_waterfall",
          max_cost_per_lead: env.MAX_ENRICHMENT_COST_PER_LEAD,
        };

        const domain = readOrganizationDomainForHunter(lead.signals_json);
        const emailMissing = isEmptyWorkEmail(lead.work_email);

        if (env.ENRICHMENT_HUNTER_API_KEY && emailMissing && domain) {
          const h = await hunterDomainSearchBestEmail({
            apiKey: env.ENRICHMENT_HUNTER_API_KEY,
            domain,
          });
          payload.hunter = {
            attempted: true,
            http_status: h.rawMeta.status,
            domain,
          };
          cumulative += 0.01;

          const p = h.person;
          if (p?.email) {
            patch.work_email = p.email;
            payload.hunter_found_email = true;
            if (p.first_name) patch.first_name = p.first_name;
            if (p.last_name) patch.last_name = p.last_name;
            if (p.position) patch.title = p.position;
          } else {
            payload.hunter_found_email = false;
          }
        } else {
          payload.hunter = {
            skipped: true,
            reason: !env.ENRICHMENT_HUNTER_API_KEY
              ? "no_hunter_api_key"
              : !emailMissing
                ? "work_email_already_set"
                : !domain
                  ? "no_organization_domain_in_signals_json"
                  : "unknown",
          };
        }

        const delta = computeEnrichmentDelta(lead, patch, ENRICHABLE_LEAD_SCALAR_KEYS);
        const signals = mergeSignalsJson(lead.signals_json, {
          waterfall_enriched_at: new Date().toISOString(),
          waterfall_hunter_attempted: Boolean(
            env.ENRICHMENT_HUNTER_API_KEY && emailMissing && domain,
          ),
        });

        const { error: runErr } = await supabase.from("enrichment_runs").insert({
          lead_id: id,
          provider_order:
            env.ENRICHMENT_HUNTER_API_KEY && emailMissing && domain
              ? "hunter_domain_search"
              : "waterfall_skip",
          status: "complete",
          cost: cumulative,
          cumulative_cost: cumulative,
          payload,
        });
        if (runErr) throw new Error(runErr.message);

        const { error: upErr } = await supabase
          .from("leads")
          .update({
            ...delta,
            signals_json: signals,
            enrichment_status: "complete",
            enrichment_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (upErr) throw new Error(upErr.message);

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("leads")
          .update({
            enrichment_status: "failed",
            enrichment_error: msg,
          })
          .eq("id", id);
        errors++;
      }
    }

    await finishWorkerRun(supabase, runId, {
      batchSize: batch,
      successCount: success,
      errorCount: errors,
    });

    return NextResponse.json({ ok: true, batch, success, errors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishWorkerRun(supabase, runId, {
      batchSize: batch,
      successCount: success,
      errorCount: errors + 1,
      errorDetails: { fatal: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
