import { NextResponse } from "next/server";
import { runMailboxHealthSweep } from "@/lib/mailbox/health-sweep";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "mailbox-health-check");

  try {
    const result = await runMailboxHealthSweep(supabase);
    await finishWorkerRun(supabase, runId, {
      batchSize: result.paused.length + result.activated.length,
      successCount: result.activated.length,
      errorCount: 0,
      errorDetails: result as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishWorkerRun(supabase, runId, {
      batchSize: 0,
      successCount: 0,
      errorCount: 1,
      errorDetails: { fatal: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
