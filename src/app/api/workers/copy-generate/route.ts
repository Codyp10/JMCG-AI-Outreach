import { NextResponse } from "next/server";
import {
  generateEmailCopy,
  runQaGate,
} from "@/lib/gemini/email-copy";
import { DEFAULT_GEMINI_MODEL } from "@/lib/gemini/generate";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

const BATCH = 10;

type ClaimedSequence = {
  sequence_id: string;
  lead_id: string;
  touch_index: number;
  max_touches: number;
  experiment_id: string | null;
  variant_key: string | null;
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const env = getFullEnv();
  const runId = await startWorkerRun(supabase, "copy-generate");

  let success = 0;
  let errors = 0;
  let batch = 0;

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_sequences_for_copy",
      { p_batch: BATCH },
    );
    if (claimError) throw new Error(claimError.message);

    const jobs = (claimed ?? []) as ClaimedSequence[];
    batch = jobs.length;

    for (const job of jobs) {
      try {
        const { data: lead, error: leadErr } = await supabase
          .from("leads")
          .select("*")
          .eq("id", job.lead_id)
          .single();
        if (leadErr || !lead) throw new Error(leadErr?.message ?? "lead missing");

        const { data: libRows, error: libErr } = await supabase
          .from("leverage_library")
          .select("*")
          .contains("industry_tags", ["hvac"])
          .limit(5);
        if (libErr) throw new Error(libErr.message);

        const library = pickLibraryEntry(
          (libRows ?? []) as Record<string, unknown>[],
          String(lead.title ?? ""),
          (lead.previous_library_entry_ids as string[]) ?? [],
        );

        if (!library) {
          throw new Error("No leverage_library entry for hvac — run seed migration.");
        }

        const libraryEntryId = String(library.id);
        const prevIds = (lead.previous_library_entry_ids as string[]) ?? [];

        let subject: string;
        let body: string;
        let regenerationAttempt = 1;
        let verdict: "pass" | "regenerate" | "failed_qa" = "pass";

        const geminiModel =
          env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

        if (env.GEMINI_API_KEY) {
          let out = await generateEmailCopy(env.GEMINI_API_KEY, geminiModel, {
            leadJson: lead as unknown as Record<string, unknown>,
            libraryEntryJson: library as unknown as Record<string, unknown>,
            touchIndex: job.touch_index,
            maxTouches: job.max_touches,
            priorSubject: null,
            cycleNumber: Number(lead.cycle_number ?? 1),
            previousLibraryEntryIds: prevIds,
          });
          subject = out.subject;
          body = out.body;

          while (regenerationAttempt <= 3) {
            verdict = await runQaGate(
              env.GEMINI_API_KEY,
              geminiModel,
              subject,
              body,
              (lead.verified_facts_json as Record<string, unknown>) ?? {},
              String(library.metrics ?? ""),
            );
            if (verdict !== "regenerate") break;
            regenerationAttempt++;
            if (regenerationAttempt > 3) break;
            out = await generateEmailCopy(env.GEMINI_API_KEY, geminiModel, {
              leadJson: lead as unknown as Record<string, unknown>,
              libraryEntryJson: library as unknown as Record<string, unknown>,
              touchIndex: job.touch_index,
              maxTouches: job.max_touches,
              priorSubject: subject,
              cycleNumber: Number(lead.cycle_number ?? 1),
              previousLibraryEntryIds: prevIds,
            });
            subject = out.subject;
            body = out.body;
          }

          const wc = wordCount(body);
          if (verdict !== "pass" || wc < 60 || wc > 140) {
            const { data: skipped, error: insErr } = await supabase
              .from("messages")
              .insert({
                sequence_id: job.sequence_id,
                lead_id: job.lead_id,
                touch_index: job.touch_index,
                experiment_variant: job.variant_key,
                subject,
                body,
                status: "skipped",
                library_entry_id: libraryEntryId,
                regeneration_attempt: Math.min(regenerationAttempt, 3),
                error_message:
                  verdict === "failed_qa"
                    ? "failed_qa_after_retries"
                    : "qa_word_count_or_verdict",
              })
              .select("id")
              .single();
            if (insErr) throw new Error(insErr.message);

            await supabase.from("qa_results").insert({
              message_id: skipped.id,
              verdict: "failed_qa",
              regeneration_attempt: Math.min(regenerationAttempt, 3),
              details: { verdict, word_count: wc },
            });

            await bumpSequence(
              supabase,
              job.sequence_id,
              job.touch_index,
              job.max_touches,
            );
            errors++;
            continue;
          }
        } else {
          subject = `Quick thought for ${lead.company_name ?? "your team"}`;
          body = [
            `Hi ${lead.first_name ?? "there"},`,
            `We help independent HVAC shops tighten LSA/PPC and reviews without blowing up dispatch — one case study: ${String(library.title)}.`,
            `Worth a 15-minute look this week?`,
          ].join("\n\n");
        }

        const { data: inserted, error: msgErr } = await supabase
          .from("messages")
          .insert({
            sequence_id: job.sequence_id,
            lead_id: job.lead_id,
            touch_index: job.touch_index,
            experiment_variant: job.variant_key,
            subject,
            body,
            status: "qa_pass",
            library_entry_id: libraryEntryId,
            regeneration_attempt: Math.min(regenerationAttempt, 3),
          })
          .select("id")
          .single();
        if (msgErr) throw new Error(msgErr.message);

        await supabase.from("qa_results").insert({
          message_id: inserted.id,
          verdict: "pass",
          regeneration_attempt: Math.min(regenerationAttempt, 3),
          details: { mode: env.GEMINI_API_KEY ? "gemini" : "stub" },
        });

        const newPrev = [...new Set([...prevIds, libraryEntryId])];
        await supabase
          .from("leads")
          .update({ previous_library_entry_ids: newPrev })
          .eq("id", job.lead_id);

        await bumpSequence(
          supabase,
          job.sequence_id,
          job.touch_index,
          job.max_touches,
        );

        success++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors++;
        console.error("copy-generate row error", msg);
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

function pickLibraryEntry(
  rows: Record<string, unknown>[],
  title: string,
  previousIds: string[],
): Record<string, unknown> | null {
  const t = title.toLowerCase();
  const candidates = rows.filter((r) => !previousIds.includes(String(r.id)));
  const pool = candidates.length ? candidates : rows;
  const scored = pool.find((r) => {
    const tags = (r.persona_tags as string[] | undefined)?.map((x) =>
      x.toLowerCase(),
    );
    if (!tags?.length) return true;
    return tags.some((tag) => t.includes(tag));
  });
  return scored ?? pool[0] ?? null;
}

async function bumpSequence(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sequenceId: string,
  touchIndex: number,
  maxTouches: number,
) {
  const next = touchIndex + 1;
  const status = next > maxTouches ? "completed" : "active";
  const { error } = await supabase
    .from("sequences")
    .update({
      next_touch_index: next,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sequenceId);
  if (error) throw new Error(error.message);
}
