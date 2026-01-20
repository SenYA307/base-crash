import { NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { signAuthTokenForFid } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  console.log("[quick-verify] Request received");

  try {
    const body = await request.json();
    const token = body?.token as string | undefined;

    console.log("[quick-verify] Token present:", !!token, "length:", token?.length || 0);

    if (!token) {
      console.log("[quick-verify] ERROR: Missing token in request body");
      return NextResponse.json(
        { error: "token is required", errorCode: "MISSING_TOKEN" },
        { status: 400 }
      );
    }

    // Determine domain for verification - must be exact domain, no protocol or port
    const host = request.headers.get("host") || "";
    const rawDomain = process.env.QUICK_AUTH_DOMAIN || host;
    // Clean domain: remove protocol, port, trailing slash
    const domain = rawDomain
      .replace(/^https?:\/\//, "")
      .split(":")[0]
      .split("/")[0]
      .trim();

    console.log("[quick-verify] Host header:", host);
    console.log("[quick-verify] QUICK_AUTH_DOMAIN env:", process.env.QUICK_AUTH_DOMAIN || "(not set)");
    console.log("[quick-verify] Using domain:", domain);

    if (!domain) {
      console.log("[quick-verify] ERROR: No domain available for verification");
      return NextResponse.json(
        { error: "Could not determine verification domain", errorCode: "NO_DOMAIN" },
        { status: 500 }
      );
    }

    // Create Quick Auth client and verify JWT
    const client = createClient();
    
    let payload;
    try {
      payload = await client.verifyJwt({ token, domain });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[quick-verify] JWT verification failed: ${errMsg}`);
      return NextResponse.json(
        { error: `Quick Auth verification failed: ${errMsg}`, errorCode: "VERIFY_FAILED" },
        { status: 400 }
      );
    }

    // Extract FID from payload
    const fid = payload.sub;
    if (!fid) {
      console.log("[quick-verify] No FID in payload");
      return NextResponse.json(
        { error: "No FID in Quick Auth payload", errorCode: "NO_FID" },
        { status: 400 }
      );
    }

    console.log(`[quick-verify] Success - FID: ${fid}`);

    // Sign our app token with FID
    const tokenResponse = signAuthTokenForFid(String(fid));

    return NextResponse.json({
      fid: String(fid),
      appToken: tokenResponse.token,
      expiresAt: tokenResponse.expiresAt,
    });
  } catch (error) {
    const message = (error as Error).message || "Quick Auth verification failed";
    console.log(`[quick-verify] Exception: ${message}`);
    return NextResponse.json(
      { error: message, errorCode: "EXCEPTION" },
      { status: 500 }
    );
  }
}
