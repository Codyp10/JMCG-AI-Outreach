import { NextResponse } from "next/server";
import {
  DEFAULT_GEMINI_MODEL,
  generateGeminiText,
} from "@/lib/gemini/generate";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { postSlackMessage } from "@/lib/integrations/slack";
import { verifyInstantlyWebhook } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

function pickStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Flatten Instantly webhook body (may be nested under `data` / `payload`). */
function unwrapWebhookPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const inner = root.data ?? root.payload ?? root.body;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return root;
}

async function classifyReply(
  apiKey: string,
  model: string,
  text: string,
): Promise<{
  reply_classification: string;
  counts_as_positive_reply: boolean;
  confidence: number;
}> {
  const raw = await generateGeminiText({
    apiKey,
    model,
    systemInstruction:
      "You classify inbound sales emails. Reply with JSON only, no markdown.",
    userMessage: `Classify this inbound sales reply. Return JSON only:
{"reply_classification":"out_of_office"|"automated"|"negative"|"neutral"|"positive"|"meeting_booked","counts_as_positive_reply":boolean,"confidence":0-1}

Message:
${text}`,
    maxOutputTokens: 300,
  });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(
      start >= 0 ? raw.slice(start, end + 1) : "{}",
    ) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const cls = sanitizeReplyClassification(
    String(parsed.reply_classification ?? "unclassified"),
  );
  return {
    reply_classification: cls,
    counts_as_positive_reply: Boolean(parsed.counts_as_positive_reply),
    confidence: Number(parsed.confidence ?? 0.5),
  };
}

const REPLY_CLASSIFICATIONS = new Set([
  "out_of_office",
  "automated",
  "negative",
  "neutral",
  "positive",
  "meeting_booked",
  "unclassified",
]);

function sanitizeReplyClassification(raw: string): string {
  const x = raw.toLowerCase().replace(/\s+/g, "_");
  return REPLY_CLASSIFICATIONS.has(x) ? x : "unclassified";
}

export async function POST(request: Request) {
  if (!verifyInstantlyWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "reply-agent");

  try {
    const rawJson = await request.json().catch(() => ({}));
    const json = unwrapWebhookPayload(rawJson);

    const text =
      pickStr(json, "reply_text") ??
      pickStr(json, "message") ??
      pickStr(json, "body") ??
      pickStr(json, "text") ??
      "";

    const eventId =
      pickStr(json, "email_id") ??
      pickStr(json, "event_id") ??
      `evt_${Date.now()}`;

    const fromAddress =
      pickStr(json, "lead_email") ?? pickStr(json, "email") ?? null;

    let leadId = pickStr(json, "lead_id");
    if (!leadId && fromAddress) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("work_email", fromAddress)
        .maybeSingle();
      leadId = lead?.id as string | undefined;
    }

    if (!leadId) {
      await finishWorkerRun(supabase, runId, {
        batchSize: 1,
        successCount: 0,
        errorCount: 1,
        errorDetails: { reason: "lead_id_not_resolved", payload: json },
      });
      return NextResponse.json(
        { ok: false, error: "Could not resolve lead_id" },
        { status: 400 },
      );
    }

    let reply_classification = "unclassified";
    let counts_as_positive_reply = false;
    let confidence = 0.5;

    try {
      const geminiKey = process.env.GEMINI_API_KEY;
      const geminiModel =
        process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
      if (geminiKey && text) {
        const c = await classifyReply(geminiKey, geminiModel, text);
        reply_classification = c.reply_classification;
        counts_as_positive_reply = c.counts_as_positive_reply;
        confidence = c.confidence;
      }
    } catch (e) {
      console.error("reply classification failed", e);
    }

    reply_classification = sanitizeReplyClassification(reply_classification);

    const { error: insErr } = await supabase.from("replies").insert({
      lead_id: leadId,
      inbound_body: text || null,
      from_address: fromAddress,
      instantly_event_id: eventId,
      reply_classification: reply_classification as
        | "out_of_office"
        | "automated"
        | "negative"
        | "neutral"
        | "positive"
        | "meeting_booked"
        | "unclassified",
      counts_as_positive_reply,
      classification_confidence: confidence,
    });

    if (insErr) {
      if (insErr.code === "23505") {
        await finishWorkerRun(supabase, runId, {
          batchSize: 1,
          successCount: 1,
          errorCount: 0,
          errorDetails: { deduped: eventId },
        });
        return NextResponse.json({ ok: true, deduped: true });
      }
      throw new Error(insErr.message);
    }

    if (text && /human|manager|lawsuit|sue/i.test(text)) {
      await supabase
        .from("replies")
        .update({
          escalation_reason: "keyword_escalation_stub",
        })
        .eq("instantly_event_id", eventId);

      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl) {
        await postSlackMessage(
          slackUrl,
          `Reply-agent escalation (stub) for lead ${leadId}: ${text.slice(0, 280)}`,
        );
      }
    }

    await finishWorkerRun(supabase, runId, {
      batchSize: 1,
      successCount: 1,
      errorCount: 0,
    });

    return NextResponse.json({
      ok: true,
      reply_classification,
      counts_as_positive_reply,
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
