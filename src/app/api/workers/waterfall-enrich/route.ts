import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";
import { getFullEnv } from "@/lib/env";

export const maxDuration = 300;

const BATCH = 20;

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

    const rows = (claimed ?? []) as { id: string }[];
    batch = rows.length;

    for (const lead of rows) {
      try {
        const cumulative = 0;
        const { error: runErr } = await supabase.from("enrichment_runs").insert({
          lead_id: lead.id,
          provider_order: "stub_waterfall",
          status: "complete",
          cost: 0,
          cumulative_cost: cumulative,
          payload: {
            note:
              "Placeholder until Clay → Lead Magic → Hunter chain is wired in Vercel worker.",
            max_cost_per_lead: env.MAX_ENRICHMENT_COST_PER_LEAD,
          },
        });
        if (runErr) throw new Error(runErr.message);

        const { error: upErr } = await supabase
          .from("leads")
          .update({
            enrichment_status: "complete",
            enrichment_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", lead.id);
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
          .eq("id", lead.id);
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
