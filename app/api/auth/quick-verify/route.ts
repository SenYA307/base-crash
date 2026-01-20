import { NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { signAuthTokenForFid } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = body?.token as string | undefined;

    if (!token) {
      return NextResponse.json(
        { error: "token is required", errorCode: "MISSING_TOKEN" },
        { status: 400 }
      );
    }

    // Determine domain for verification
    const host = request.headers.get("host") || "";
    const domain = process.env.QUICK_AUTH_DOMAIN || host.split(":")[0];

    if (!domain) {
      console.log("[quick-verify] No domain available for verification");
      return NextResponse.json(
        { error: "Could not determine verification domain", errorCode: "NO_DOMAIN" },
        { status: 500 }
      );
    }

    console.log(`[quick-verify] Verifying token for domain: ${domain}`);

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
