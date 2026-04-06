import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/workers/cron-auth";

export const maxDuration = 60;

/** Health check for uptime monitors (no secret). */
export async function GET() {
  return NextResponse.json({ ok: true, service: "jmcg-ai-outreach" });
}

/** Verify pg_cron → Vercel can authenticate (optional smoke test). */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, authenticated: true });
}
