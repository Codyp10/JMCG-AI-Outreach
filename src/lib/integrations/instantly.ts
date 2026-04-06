/**
 * Instantly API v2 — https://api.instantly.ai/api/v2/
 * Auth: Authorization: Bearer <INSTANTLY_API_KEY> (not query params).
 */

const BASE = "https://api.instantly.ai/api/v2";

export type InstantlyLeadRow = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  /** Maps to {{personalization}} in campaign templates when used */
  personalization?: string;
};

/**
 * POST /api/v2/leads/add — add leads to a campaign (sequence content lives in Instantly).
 */
export async function addLeadsToCampaign(
  apiKey: string,
  campaignId: string,
  leads: InstantlyLeadRow[],
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; error: string }> {
  const res = await fetch(`${BASE}/leads/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      campaign_id: campaignId,
      leads,
    }),
  });

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : res.statusText;
    return { ok: false, error: `${res.status} ${msg}` };
  }

  return { ok: true, status: res.status, body: parsed };
}

/**
 * POST /api/v2/emails/reply — reply in-thread (use webhook `email_id` as reply_to_uuid).
 */
export async function sendEmailReply(
  apiKey: string,
  params: {
    replyToUuid: string;
    eaccount: string;
    subject: string;
    textBody: string;
  },
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; error: string }> {
  const res = await fetch(`${BASE}/emails/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      reply_to_uuid: params.replyToUuid,
      eaccount: params.eaccount,
      subject: params.subject,
      body: { text: params.textBody },
    }),
  });

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : res.statusText;
    return { ok: false, error: `${res.status} ${msg}` };
  }

  return { ok: true, status: res.status, body: parsed };
}
