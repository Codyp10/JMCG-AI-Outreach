import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  channelFlagsForScore,
  scoreHvacLead,
} from "@/lib/scoring/hvac-rubric";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 50;

function geoAllowlist(): string[] {
  return (process.env.GEO_ALLOWLIST ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "score");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_leads_for_scoring",
      { p_batch: BATCH },
    );
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as Record<string, unknown>[];
    batch = rows.length;
    const allowlist = geoAllowlist();

    for (const row of rows) {
      try {
        const id = String(row.id);
        const result = scoreHvacLead({
          companyName: (row.company_name as string) ?? null,
          googleReviewCount: (row.google_review_count as number) ?? null,
          hasActiveHvacHiring: (row.has_active_hvac_hiring as boolean) ?? null,
          runsGoogleLsaOrPpc: (row.runs_google_lsa_or_ppc as boolean) ?? null,
          runsMetaAds: (row.runs_meta_ads as boolean) ?? null,
          fsmSoftware: (row.fsm_software as string) ?? null,
          title: (row.title as string) ?? null,
          geo: (row.geo as string) ?? null,
          geoAllowlist: allowlist,
        });

        const { error: scoreErr } = await supabase.from("scores").insert({
          lead_id: id,
          total_score: result.total,
          rubric_breakdown: result.breakdown,
        });
        if (scoreErr) throw new Error(scoreErr.message);

        const flags = channelFlagsForScore(result.total);

        const { error: upErr } = await supabase
          .from("leads")
          .update({
            lead_score: result.total,
            scoring_status: "complete",
            scoring_error: null,
            icp_disqualification_reason: result.icpDisqualificationReason,
            channel_flags: flags,
          })
          .eq("id", id);
        if (upErr) throw new Error(upErr.message);

        if (!result.icpDisqualificationReason) {
          const { count, error: cntErr } = await supabase
            .from("sequences")
            .select("*", { count: "exact", head: true })
            .eq("lead_id", id)
            .eq("status", "active");
          if (cntErr) throw new Error(cntErr.message);
          if ((count ?? 0) === 0) {
            const { error: seqErr } = await supabase.from("sequences").insert({
              lead_id: id,
              status: "active",
              max_touches: 4,
              next_touch_index: 1,
            });
            if (seqErr) throw new Error(seqErr.message);
          }
        }

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("leads")
          .update({
            scoring_status: "failed",
            scoring_error: msg,
          })
          .eq("id", String(row.id));
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
