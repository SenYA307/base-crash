import { NextResponse } from "next/server";
import { signAuthToken, verifySignature, type VerifyResult } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const debugEnabled = process.env.DEBUG_SIGN === "1";

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

    // Debug logging (only when DEBUG_SIGN=1) - never log full signature
    if (debugEnabled) {
      const sigMeta: Record<string, unknown> = {
        rawType: typeof signature,
      };
      if (typeof signature === "string") {
        sigMeta.rawLen = signature.length;
        sigMeta.startsWith0x = signature.startsWith("0x");
        sigMeta.prefix = signature.slice(0, 12) + "...";
      } else if (signature instanceof Uint8Array) {
        sigMeta.rawLen = signature.length;
        sigMeta.isUint8Array = true;
      } else if (signature && typeof signature === "object") {
        sigMeta.keys = Object.keys(signature);
      }
      console.log("[auth/verify] Signature metadata:", sigMeta);
      if (clientDebug) {
        console.log("[auth/verify] Client debug:", clientDebug);
      }
    }

    const result = await verifySignature({ address, signature, nonce });

    if (!result.ok) {
      // Log failure details
      if (debugEnabled) {
        console.log("[auth/verify] Normalization failed:", {
          errorCode: result.errorCode,
          detectedKind: result.detectedKind,
          rawLen: result.rawLen,
        });
      }
      return NextResponse.json(
        {
          error: result.error,
          errorCode: result.errorCode,
          detectedKind: result.detectedKind,
          rawLen: result.rawLen,
          normalizedLen: result.normalizedLen,
        },
        { status: 400 }
      );
    }

    // Log success
    if (debugEnabled) {
      console.log("[auth/verify] Success:", {
        kind: result.kind,
        compactApplied: result.compactApplied,
      });
    }

    const tokenResponse = signAuthToken(address);
    return NextResponse.json(tokenResponse);
  } catch (error) {
    const message = (error as Error).message || "Verification failed";

    if (debugEnabled) {
      console.log("[auth/verify] Exception:", message);
    }

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
