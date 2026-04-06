/**
 * Smartlead API — illustrative client for send-queue.
 * Confirm paths and payload shape against current Smartlead API docs before production.
 */

export type SmartleadSendPayload = {
  campaignId: string;
  email: string;
  subject: string;
  body: string;
  customFields?: Record<string, string>;
};

export async function pushLeadToSmartlead(
  apiKey: string,
  payload: SmartleadSendPayload,
): Promise<{ ok: true; externalId: string } | { ok: false; error: string }> {
  const base = "https://server.smartlead.ai/api/v1";
  const url = `${base}/campaigns/${encodeURIComponent(payload.campaignId)}/leads`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      email: payload.email,
      subject: payload.subject,
      body: payload.body,
      custom_fields: payload.customFields,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    return { ok: false, error: `${res.status} ${errText}` };
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, externalId: String(json.id ?? `sl_${Date.now()}`) };
}
