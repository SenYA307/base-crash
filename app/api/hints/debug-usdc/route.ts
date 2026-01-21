import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Log } from "viem";
import { base } from "viem/chains";
import {
  parseTransferEvents,
  USDC_ADDRESS,
  getTreasuryAddress,
  getRequiredUsdc,
} from "@/lib/hints";

export const runtime = "nodejs";

/**
 * Debug endpoint for USDC verification.
 * Requires DEBUG_API_KEY header for security.
 */
export async function GET(request: NextRequest) {
  // Check debug key
  const debugKey = request.headers.get("x-debug-key");
  const expectedKey = process.env.DEBUG_API_KEY;

  if (!expectedKey) {
    return NextResponse.json(
      { ok: false, error: "Debug endpoint not configured" },
      { status: 503 }
    );
  }

  if (debugKey !== expectedKey) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get("txHash");

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing txHash parameter" },
      { status: 400 }
    );
  }

  try {
    const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    const treasury = getTreasuryAddress();
    const treasuryLower = treasury.toLowerCase();
    const requiredUsdc = getRequiredUsdc();

    // Get transaction
    let tx;
    try {
      tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    } catch {
      return NextResponse.json({
        ok: false,
        error: "Transaction not found",
        txHash,
      });
    }

    // Get transaction receipt
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
    } catch {
      return NextResponse.json({
        ok: false,
        error: "Transaction receipt not available (pending?)",
        txHash,
        txFound: !!tx,
        txFrom: tx?.from,
        txTo: tx?.to,
      });
    }

    // Parse all USDC transfer events
    const allUsdcTransfers = parseTransferEvents(
      receipt.logs as Log[],
      USDC_ADDRESS
    );

    // Find transfers to treasury
    const transfersToTreasury = allUsdcTransfers.filter(
      (t) => t.to === treasuryLower
    );

    // Check if any meet the required amount
    const validTransfers = transfersToTreasury.filter(
      (t) => t.value >= requiredUsdc
    );

    return NextResponse.json({
      ok: true,
      txHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      txFrom: tx?.from,
      txTo: tx?.to,
      gasUsed: receipt.gasUsed.toString(),
      logsCount: receipt.logs.length,
      // USDC config
      usdcAddress: USDC_ADDRESS,
      treasuryAddress: treasury,
      requiredUsdc: requiredUsdc.toString(),
      // Analysis
      allUsdcTransfersCount: allUsdcTransfers.length,
      allUsdcTransfers: allUsdcTransfers.map((t) => ({
        from: t.from,
        to: t.to,
        value: t.value.toString(),
      })),
      transfersToTreasury: transfersToTreasury.map((t) => ({
        from: t.from,
        value: t.value.toString(),
      })),
      validTransfersCount: validTransfers.length,
      wouldVerify: validTransfers.length > 0,
      buyer: validTransfers.length > 0 ? validTransfers[0].from : null,
    });
  } catch (error) {
    console.error("[debug-usdc] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Debug failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
