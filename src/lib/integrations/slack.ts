export async function postSlackMessage(
  webhookUrl: string,
  text: string,
  extras?: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...extras }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
}
