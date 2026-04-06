const BEARER = /^Bearer\s+(.+)$/i;

export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header) {
    const m = BEARER.exec(header);
    if (m?.[1] === secret) return true;
  }

  const alt =
    request.headers.get("x-cron-secret") ??
    request.headers.get("x-vercel-cron-secret");
  return alt === secret;
}

export function verifySmartleadWebhook(request: Request): boolean {
  const expected = process.env.SMARTLEAD_WEBHOOK_SECRET;
  if (!expected) return false;

  const header =
    request.headers.get("x-smartlead-signature") ??
    request.headers.get("x-webhook-secret") ??
    request.headers.get("authorization");

  if (header?.startsWith("Bearer ")) {
    return header.slice(7) === expected;
  }
  return header === expected;
}
