import { generateGeminiText } from "@/lib/gemini/generate";

export type CopyRequest = {
  leadJson: Record<string, unknown>;
  libraryEntryJson: Record<string, unknown>;
  touchIndex: number;
  maxTouches: number;
  priorSubject: string | null;
  cycleNumber: number;
  previousLibraryEntryIds: string[];
};

export type CopyOutput = {
  subject: string;
  body: string;
  libraryEntryId: string;
  personalizationTokensUsed: string[];
};

const SYSTEM = `You are an expert B2B cold email copywriter for US residential HVAC (heating & cooling) contractors.
Output valid JSON only with keys: subject, body, aida_trace (object with attention, interest, desire, action strings), library_entry_id, personalization_tokens_used (array of strings).
Body length 75-120 words. At most one question in the body. No fabricated metrics.`;

export async function generateEmailCopy(
  apiKey: string,
  model: string,
  req: CopyRequest,
): Promise<CopyOutput> {
  const user = JSON.stringify({
    LEAD: req.leadJson,
    LEVERAGE_LIBRARY_ENTRY: req.libraryEntryJson,
    SEQUENCE_CONTEXT: {
      touch_index: req.touchIndex,
      max_touches: req.maxTouches,
      prior_subject: req.priorSubject,
      cycle_number: req.cycleNumber,
      previous_library_entry_ids: req.previousLibraryEntryIds,
    },
  });

  const text = await generateGeminiText({
    apiKey,
    model,
    systemInstruction: SYSTEM,
    userMessage: user,
    maxOutputTokens: 1200,
  });

  const parsed = parseJsonLoose(text);
  return {
    subject: String(parsed.subject ?? "Quick idea for your HVAC marketing"),
    body: String(parsed.body ?? ""),
    libraryEntryId: String(
      parsed.library_entry_id ?? req.libraryEntryJson.id ?? "",
    ),
    personalizationTokensUsed: Array.isArray(parsed.personalization_tokens_used)
      ? parsed.personalization_tokens_used.map(String)
      : [],
  };
}

export async function runQaGate(
  apiKey: string,
  model: string,
  subject: string,
  body: string,
  verifiedFacts: Record<string, unknown>,
  libraryMetrics: string,
): Promise<"pass" | "regenerate" | "failed_qa"> {
  const prompt = `You are a strict email QA gate. Return JSON only: {"verdict":"pass"|"regenerate"|"failed_qa","reasons":[]}
Rules:
- Body must be 75-120 words (approximate; pass if close).
- At most ONE question mark in the body.
- Every number in subject/body must appear in VERIFIED_FACTS or LIBRARY_METRICS text.
- No spam superlatives: guaranteed, 100%%, free money, etc.

SUBJECT: ${subject}
BODY: ${body}
VERIFIED_FACTS: ${JSON.stringify(verifiedFacts)}
LIBRARY_METRICS: ${libraryMetrics}`;

  const text = await generateGeminiText({
    apiKey,
    model,
    systemInstruction:
      "You output only valid JSON for email QA. No markdown fences.",
    userMessage: prompt,
    maxOutputTokens: 400,
  });

  const parsed = parseJsonLoose(text);
  const v = String(parsed.verdict ?? "regenerate").toLowerCase();
  if (v === "pass" || v === "failed_qa") return v;
  return "regenerate";
}

function parseJsonLoose(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
