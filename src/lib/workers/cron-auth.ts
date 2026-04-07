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

/** Instantly webhooks: register with custom header `Authorization: Bearer <secret>`. */
export function verifyInstantlyWebhook(request: Request): boolean {
  const expected = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (header) {
    const m = BEARER.exec(header);
    if (m?.[1] === expected) return true;
    if (header === expected) return true;
  }

  return (
    request.headers.get("x-webhook-secret") === expected ||
    request.headers.get("x-instantly-signature") === expected
  );
}

