import { NextResponse } from "next/server";
import { HIGH_TOUCH_MIN_SCORE } from "@/lib/scoring/hvac-rubric";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 50;

function uuidRowsFromRpc(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const item of data) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object") {
      const v = Object.values(item as Record<string, unknown>)[0];
      if (typeof v === "string") out.push(v);
    }
  }
  return out;
}

/**
 * Creates `channel_dispatch` rows (pending handwritten mail) for high-touch leads.
 * Run before `phone-enrich` on cron so phone scrape only runs after send is initiated in the DB.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "handwritten-enqueue");

  try {
    const { data, error } = await supabase.rpc("enqueue_handwritten_mail_dispatch", {
      p_batch: BATCH,
      p_min_score: HIGH_TOUCH_MIN_SCORE,
    });
    if (error) throw new Error(error.message);

    const n = uuidRowsFromRpc(data).length;

    await finishWorkerRun(supabase, runId, {
      batchSize: n,
      successCount: n,
      errorCount: 0,
    });

    return NextResponse.json({
      ok: true,
      enqueued: n,
      min_score: HIGH_TOUCH_MIN_SCORE,
    });
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
