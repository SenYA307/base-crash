import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import {
  calculateRequiredWei,
  getTreasuryAddress,
  getHintsContractAddress,
  runIdToBytes32,
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
      hasContractAddress: Boolean(process.env.HINTS_CONTRACT_ADDRESS),
    });
  }

  try {
    // Parse body - NO auth token required for hint purchases
    // We verify ownership via on-chain event or tx.from
    const body = await request.json();
    const { runId, address } = body;

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    if (!address || typeof address !== "string" || !address.startsWith("0x")) {
      return NextResponse.json({ error: "Missing or invalid wallet address" }, { status: 400 });
    }

    // Calculate price
    const requiredWei = await calculateRequiredWei();
    const treasuryAddress = getTreasuryAddress();
    const contractAddress = getHintsContractAddress();

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + INTENT_EXPIRY_SECONDS;

    // Convert runId to bytes32 for contract call
    const runIdBytes32 = runIdToBytes32(runId);

    const intentPayload: IntentPayload = {
      runId,
      runIdBytes32,
      address: address.toLowerCase(),
      requiredWei: requiredWei.toString(),
      treasuryAddress,
      contractAddress: contractAddress || null,
      packSize: HINTS_PACK_SIZE,
      iat,
      exp,
    };

    const intentToken = signIntentToken(intentPayload);

    console.log("[create-intent] Created intent for address:", address.toLowerCase().slice(0, 10) + "...");

    return NextResponse.json({
      intentToken,
      requiredWei: requiredWei.toString(),
      treasuryAddress,
      // Contract-based purchase (preferred)
      contractAddress: contractAddress || null,
      runIdBytes32,
      // Legacy fields
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
