import { NextResponse } from "next/server";
import { signAuthToken, verifySignature } from "@/lib/auth";
import { logSignatureDebug } from "@/lib/signature";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const address = body?.address as string | undefined;
    const signature = body?.signature; // Accept unknown type for robust handling
    const nonce = body?.nonce as string | undefined;

    if (!address || signature == null || !nonce) {
      return NextResponse.json(
        { error: "address, signature, and nonce are required" },
        { status: 400 }
      );
    }

    // Debug logging (only when DEBUG_SIGN=1)
    logSignatureDebug("api-verify-received", signature);

    await verifySignature({ address, signature, nonce });
    const tokenResponse = signAuthToken(address);

    return NextResponse.json(tokenResponse);
  } catch (error) {
    const message = (error as Error).message || "Verification failed";
    
    // Enhanced error response with code
    const errorCode = message.includes("format") || message.includes("length")
      ? "SIGNATURE_FORMAT_ERROR"
      : message.includes("expired")
      ? "NONCE_EXPIRED"
      : message.includes("Invalid signature")
      ? "INVALID_SIGNATURE"
      : "VERIFICATION_FAILED";

    return NextResponse.json(
      { error: message, errorCode },
      { status: 400 }
    );
  }
}
