import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Stub webhook endpoint for Farcaster Mini App notifications.
 * Returns 200 OK for any POST request.
 */
export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Webhook endpoint active" });
}
