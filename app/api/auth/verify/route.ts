import { NextResponse } from "next/server";
import { signAuthToken, verifySignature, type VerifyResult } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const address = body?.address as string | undefined;
    const signature = body?.signature; // Accept unknown type for robust handling
    const nonce = body?.nonce as string | undefined;
    const clientDebug = body?.debug; // Debug info from client

    if (!address || signature == null || !nonce) {
      return NextResponse.json(
        { error: "address, signature, and nonce are required", errorCode: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    // ALWAYS log signature metadata to diagnose Base app issue
    const sigMeta: Record<string, unknown> = {
      rawType: typeof signature,
    };
    if (typeof signature === "string") {
      sigMeta.rawLen = signature.length;
      sigMeta.startsWith0x = signature.startsWith("0x");
      sigMeta.prefix = signature.slice(0, 16) + "...";
      sigMeta.suffix = "..." + signature.slice(-8);
    } else if (signature instanceof Uint8Array) {
      sigMeta.rawLen = signature.length;
      sigMeta.isUint8Array = true;
    } else if (signature && typeof signature === "object") {
      sigMeta.keys = Object.keys(signature);
      sigMeta.objectPreview = JSON.stringify(signature).slice(0, 100);
    }
    console.log("[auth/verify] Signature metadata:", JSON.stringify(sigMeta));
    if (clientDebug) {
      console.log("[auth/verify] Client debug:", JSON.stringify(clientDebug));
    }

    const result = await verifySignature({ address, signature, nonce });

    if (!result.ok) {
      // ALWAYS log failure details
      const failureInfo = {
        errorCode: result.errorCode,
        detectedKind: result.detectedKind,
        rawLen: result.rawLen,
        normalizedLen: result.normalizedLen,
        error: result.error,
        hint: result.rawLen && result.rawLen > 132
          ? "Oversized signature detected. Extraction was attempted but failed to find valid ECDSA signature."
          : "Standard signature expected (132 or 130 chars for 0x-prefixed hex)",
      };
      console.log("[auth/verify] FAILED:", JSON.stringify(failureInfo));
      return NextResponse.json(
        {
          ok: false,
          ...failureInfo,
        },
        { status: 400 }
      );
    }

    // Log success
    const successInfo = {
      kind: result.kind,
      compactApplied: result.compactApplied,
      extracted: result.kind.includes("extracted"),
    };
    console.log("[auth/verify] SUCCESS:", JSON.stringify(successInfo));

    const tokenResponse = signAuthToken(address);
    return NextResponse.json(tokenResponse);
  } catch (error) {
    const message = (error as Error).message || "Verification failed";

    console.log("[auth/verify] EXCEPTION:", message);

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
