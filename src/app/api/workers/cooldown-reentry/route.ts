import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 50;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "cooldown-reentry");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_cooldown_leads",
      { p_batch: BATCH },
    );
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as { lead_id: string }[];
    batch = rows.length;

    for (const row of rows) {
      try {
        const { data: lead, error: leadErr } = await supabase
          .from("leads")
          .select("cycle_number")
          .eq("id", row.lead_id)
          .single();
        if (leadErr) throw new Error(leadErr.message);

        const nextCycle = Number(lead?.cycle_number ?? 1) + 1;

        const { error: delDispErr } = await supabase
          .from("channel_dispatch")
          .delete()
          .eq("lead_id", row.lead_id);
        if (delDispErr) throw new Error(delDispErr.message);

        const { error: upErr } = await supabase
          .from("leads")
          .update({
            cycle_number: nextCycle,
            enrichment_status: "pending",
            scoring_status: "pending",
            lead_score: null,
            phone_enriched: false,
            phone_enrich_in_progress: false,
            enrichment_error: null,
            scoring_error: null,
            icp_disqualification_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.lead_id);
        if (upErr) throw new Error(upErr.message);

        await supabase
          .from("sequences")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("lead_id", row.lead_id)
          .eq("status", "active");

        const { error: seqErr } = await supabase.from("sequences").insert({
          lead_id: row.lead_id,
          status: "active",
          max_touches: 4,
          next_touch_index: 1,
        });
        if (seqErr) throw new Error(seqErr.message);

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("cooldown-reentry row", msg);
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
