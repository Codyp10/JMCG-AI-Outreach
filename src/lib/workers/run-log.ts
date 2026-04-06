import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkerRunFinish = {
  batchSize: number;
  successCount: number;
  errorCount: number;
  errorDetails?: Record<string, unknown>;
};

export async function startWorkerRun(
  supabase: SupabaseClient,
  workerName: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("worker_runs")
    .insert({ worker_name: workerName, batch_size: 0 })
    .select("id")
    .single();

  if (error) throw new Error(`worker_runs insert: ${error.message}`);
  return data.id as string;
}

export async function finishWorkerRun(
  supabase: SupabaseClient,
  runId: string,
  finish: WorkerRunFinish,
): Promise<void> {
  const { error } = await supabase
    .from("worker_runs")
    .update({
      completed_at: new Date().toISOString(),
      batch_size: finish.batchSize,
      success_count: finish.successCount,
      error_count: finish.errorCount,
      error_details: finish.errorDetails ?? null,
    })
    .eq("id", runId);

  if (error) throw new Error(`worker_runs update: ${error.message}`);
}
