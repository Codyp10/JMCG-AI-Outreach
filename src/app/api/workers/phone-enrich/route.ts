import { NextResponse } from "next/server";
import { HIGH_TOUCH_MIN_SCORE } from "@/lib/scoring/hvac-rubric";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 25;

/**
 * Score-gated phone enrichment: updates `leads.phone` when a vendor returns a number.
 * For manual calling only — this app does not dial or send voicemail.
 * Only runs after `handwritten-enqueue` has created a `channel_dispatch` row (same tier as `HIGH_TOUCH_MIN_SCORE`).
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "phone-enrich");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_leads_for_phone_enrich",
      { p_batch: BATCH, p_min_score: HIGH_TOUCH_MIN_SCORE },
    );
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as { id: string; phone: string | null }[];
    batch = rows.length;

    for (const lead of rows) {
      try {
        const phone = lead.phone?.trim() || null;

        const { error: runErr } = await supabase.from("enrichment_runs").insert({
          lead_id: lead.id,
          provider_order: "phone_enrichment_manual_tier",
          status: "complete",
          cost: 0,
          cumulative_cost: 0,
          payload: {
            note:
              "Manual-dial-only: wire Lead Magic / Clay / etc. when API keys are set. No auto-dial.",
            resolved_phone: phone,
            min_score: HIGH_TOUCH_MIN_SCORE,
          },
        });
        if (runErr) throw new Error(runErr.message);

        const updatePayload: Record<string, string | boolean> = {
          phone_enriched: true,
          phone_enrich_in_progress: false,
          updated_at: new Date().toISOString(),
        };
        if (phone) updatePayload.phone = phone;

        const { error: upErr } = await supabase
          .from("leads")
          .update(updatePayload)
          .eq("id", lead.id);
        if (upErr) throw new Error(upErr.message);

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("leads")
          .update({
            phone_enrich_in_progress: false,
            enrichment_error: msg,
          })
          .eq("id", lead.id);
        errors++;
      }
    }

    await finishWorkerRun(supabase, runId, {
      batchSize: batch,
      successCount: success,
      errorCount: errors,
    });

    return NextResponse.json({
      ok: true,
      batch,
      success,
      errors,
      min_score: HIGH_TOUCH_MIN_SCORE,
    });
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
