import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import {
  getTreasuryAddress,
  runIdToBytes32,
  signIntentToken,
  getRequiredUsdc,
  USDC_ADDRESS,
  USDC_DECIMALS,
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
    // Parse body - NO auth token required for hint purchases
    // We verify ownership via USDC Transfer event
    const body = await request.json();
    const { runId, address } = body;

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    if (!address || typeof address !== "string" || !address.startsWith("0x")) {
      return NextResponse.json({ error: "Missing or invalid wallet address" }, { status: 400 });
    }

    // USDC payment details
    const requiredUsdc = getRequiredUsdc();
    const treasuryAddress = getTreasuryAddress();

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + INTENT_EXPIRY_SECONDS;

    // Convert runId to bytes32 (for tracking)
    const runIdBytes32 = runIdToBytes32(runId);

    const intentPayload: IntentPayload = {
      runId,
      runIdBytes32,
      address: address.toLowerCase(),
      requiredUsdc: requiredUsdc.toString(),
      tokenAddress: USDC_ADDRESS,
      treasuryAddress,
      packSize: HINTS_PACK_SIZE,
      iat,
      exp,
    };

    const intentToken = signIntentToken(intentPayload);

    console.log("[create-intent] USDC intent for:", address.toLowerCase().slice(0, 10) + "...", "amount:", requiredUsdc.toString());

    return NextResponse.json({
      intentToken,
      // USDC payment details
      requiredUsdc: requiredUsdc.toString(),
      tokenAddress: USDC_ADDRESS,
      tokenDecimals: USDC_DECIMALS,
      treasuryAddress,
      runIdBytes32,
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
