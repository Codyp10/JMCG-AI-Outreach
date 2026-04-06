import { NextResponse } from "next/server";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { postSlackMessage } from "@/lib/integrations/slack";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "monthly-optimize");

  try {
    const { count: sent } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent");

    const { count: positive } = await supabase
      .from("replies")
      .select("*", { count: "exact", head: true })
      .eq("counts_as_positive_reply", true);

    const cycleDate = new Date().toISOString().slice(0, 10);

    await supabase.from("optimization_log").insert({
      cycle_date: cycleDate,
      change_type: "monthly_snapshot",
      old_value: {},
      new_value: {
        sent_messages: sent ?? 0,
        positive_replies: positive ?? 0,
      },
      data_basis: {
        note:
          "Placeholder aggregate — wire variant comparison (min 150 sends) and promotion rules per plan §5.",
      },
    });

    const env = getFullEnv();
    if (env.SLACK_WEBHOOK_URL) {
      await postSlackMessage(
        env.SLACK_WEBHOOK_URL,
        `Monthly optimization snapshot (${cycleDate}): sent=${sent ?? 0}, positive_replies=${positive ?? 0}. Auto-apply rules not yet enabled.`,
      );
    }

    await finishWorkerRun(supabase, runId, {
      batchSize: 1,
      successCount: 1,
      errorCount: 0,
    });

    return NextResponse.json({
      ok: true,
      cycleDate,
      sent,
      positive,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishWorkerRun(supabase, runId, {
      batchSize: 1,
      successCount: 0,
      errorCount: 1,
      errorDetails: { fatal: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
