import { NextResponse } from "next/server";
import { pushLeadToSmartlead } from "@/lib/integrations/smartlead";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 25;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const env = getFullEnv();
  const runId = await startWorkerRun(supabase, "send-queue");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_messages_for_send",
      { p_batch: BATCH },
    );
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as {
      id: string;
      lead_id: string;
      subject: string;
      body: string;
    }[];
    batch = rows.length;

    if (!env.SMARTLEAD_API_KEY || !env.SMARTLEAD_DEFAULT_CAMPAIGN_ID) {
      for (const m of rows) {
        await supabase
          .from("messages")
          .update({
            status: "qa_pass",
            error_message:
              "SMARTLEAD_API_KEY or SMARTLEAD_DEFAULT_CAMPAIGN_ID missing — reset to qa_pass for retry.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
      }
      await finishWorkerRun(supabase, runId, {
        batchSize: batch,
        successCount: 0,
        errorCount: batch,
        errorDetails: { reason: "smartlead_not_configured" },
      });
      return NextResponse.json({
        ok: false,
        batch,
        error: "Smartlead not configured; messages reverted to qa_pass.",
      });
    }

    for (const m of rows) {
      try {
        const { data: lead, error: leadErr } = await supabase
          .from("leads")
          .select("work_email, smartlead_lead_id")
          .eq("id", m.lead_id)
          .single();
        if (leadErr || !lead?.work_email) {
          throw new Error(leadErr?.message ?? "Lead email missing");
        }

        const result = await pushLeadToSmartlead(env.SMARTLEAD_API_KEY, {
          campaignId: env.SMARTLEAD_DEFAULT_CAMPAIGN_ID,
          email: lead.work_email,
          subject: m.subject,
          body: m.body,
        });

        if (!result.ok) {
          throw new Error(result.error);
        }

        const { error: upErr } = await supabase
          .from("messages")
          .update({
            status: "sent",
            smartlead_message_id: result.externalId,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
        if (upErr) throw new Error(upErr.message);

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("messages")
          .update({
            status: "failed",
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
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
