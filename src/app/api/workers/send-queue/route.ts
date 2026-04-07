import { NextResponse } from "next/server";
import { addLeadsToCampaign } from "@/lib/integrations/instantly";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 25;

async function resolveDefaultInstantlyCampaignId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  envFallback: string | undefined,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("integration_settings")
    .select("instantly_default_campaign_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("integration_settings read failed", error.message);
  }
  const fromDb = data?.instantly_default_campaign_id?.trim();
  if (fromDb) return fromDb;
  const fromEnv = envFallback?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

function refFromInstantlyResponse(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.id === "string") return o.id;
    if (Array.isArray(o.leads) && o.leads[0] && typeof o.leads[0] === "object") {
      const first = o.leads[0] as Record<string, unknown>;
      if (typeof first.id === "string") return first.id;
    }
  }
  return fallback;
}

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

    const campaignId = await resolveDefaultInstantlyCampaignId(
      supabase,
      env.INSTANTLY_DEFAULT_CAMPAIGN_ID,
    );

    if (!env.INSTANTLY_API_KEY || !campaignId) {
      for (const m of rows) {
        await supabase
          .from("messages")
          .update({
            status: "qa_pass",
            error_message:
              "INSTANTLY_API_KEY missing or default campaign unset — set integration_settings.instantly_default_campaign_id (id=1) or INSTANTLY_DEFAULT_CAMPAIGN_ID env; reset to qa_pass for retry.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
      }
      await finishWorkerRun(supabase, runId, {
        batchSize: batch,
        successCount: 0,
        errorCount: batch,
        errorDetails: { reason: "instantly_not_configured" },
      });
      return NextResponse.json({
        ok: false,
        batch,
        error:
          "Instantly not configured (API key or default campaign); messages reverted to qa_pass.",
      });
    }

    for (const m of rows) {
      try {
        const { data: lead, error: leadErr } = await supabase
          .from("leads")
          .select("work_email, first_name, last_name, company_name, instantly_lead_id")
          .eq("id", m.lead_id)
          .single();
        if (leadErr || !lead?.work_email) {
          throw new Error(leadErr?.message ?? "Lead email missing");
        }

        const result = await addLeadsToCampaign(
          env.INSTANTLY_API_KEY,
          campaignId,
          [
            {
              email: lead.work_email,
              first_name: lead.first_name ?? undefined,
              last_name: lead.last_name ?? undefined,
              company_name: lead.company_name ?? undefined,
              personalization: `${m.subject}\n\n${m.body}`,
            },
          ],
        );

        if (!result.ok) {
          throw new Error(result.error);
        }

        const externalRef = refFromInstantlyResponse(
          result.body,
          `instantly:${m.id}:${Date.now()}`,
        );

        const { error: upErr } = await supabase
          .from("messages")
          .update({
            status: "sent",
            instantly_campaign_id: campaignId,
            instantly_email_id: externalRef,
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
