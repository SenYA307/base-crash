import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth";
import {
  calculateRequiredWei,
  getTreasuryAddress,
  signIntentToken,
  HINTS_PACK_SIZE,
  INTENT_EXPIRY_SECONDS,
  type IntentPayload,
} from "@/lib/hints";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

// One-time debug log for env issues
let hasLoggedDebug = false;

export async function POST(request: NextRequest) {
  // Dev debug logging (once per server start)
  if (process.env.DEBUG === "1" && !hasLoggedDebug) {
    hasLoggedDebug = true;
    const cwd = process.cwd();
    const envLocalPath = path.resolve(cwd, ".env.local");
    console.log("[create-intent] Debug:", {
      cwd,
      envLocalExists: fs.existsSync(envLocalPath),
      hasHintsSecret: Boolean(process.env.HINTS_PAYMENT_SECRET),
      hasAuthSecret: Boolean(process.env.AUTH_TOKEN_SECRET),
    });
  }

  try {
    // Verify auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const payload = verifyAuthToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const { runId } = body;

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    // Calculate price
    const requiredWei = await calculateRequiredWei();
    const treasuryAddress = getTreasuryAddress();

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + INTENT_EXPIRY_SECONDS;

    // Hint purchases require a wallet address for on-chain verification
    if (!payload.address) {
      return NextResponse.json(
        { error: "Wallet address required for hint purchase. Please connect your wallet." },
        { status: 400 }
      );
    }

    const intentPayload: IntentPayload = {
      runId,
      address: payload.address,
      requiredWei: requiredWei.toString(),
      treasuryAddress,
      packSize: HINTS_PACK_SIZE,
      iat,
      exp,
    };

    const intentToken = signIntentToken(intentPayload);

    return NextResponse.json({
      intentToken,
      requiredWei: requiredWei.toString(),
      treasuryAddress,
      expiresAt: exp,
      packSize: HINTS_PACK_SIZE,
    });
  } catch (error) {
    console.error("[create-intent] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
