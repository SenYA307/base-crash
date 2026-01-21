import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Log } from "viem";
import { base } from "viem/chains";
import {
  parseTransferEvents,
  getTreasuryAddress,
  USDC_ADDRESS,
} from "@/lib/hints";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (process.env.DEBUG_PAY !== "1") {
    return NextResponse.json(
      { error: "Debug endpoint disabled" },
      { status: 403 }
    );
  }

  const txHash = request.nextUrl.searchParams.get("txHash");

  if (!txHash || !txHash.startsWith("0x")) {
    return NextResponse.json({ error: "Missing or invalid txHash" }, { status: 400 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });

  try {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash as `0x${string}` }),
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    ]);

    const transfers = receipt?.logs
      ? parseTransferEvents(receipt.logs as Log[], USDC_ADDRESS)
      : [];
    const treasury = getTreasuryAddress().toLowerCase();

    return NextResponse.json({
      txHash,
      txTo: tx?.to || null,
      receiptTo: receipt?.to || null,
      usdcAddress: USDC_ADDRESS,
      treasuryAddress: getTreasuryAddress(),
      foundTransfers: transfers.map((t) => ({
        from: t.from,
        to: t.to,
        value: t.value.toString(),
        valueUsdc: (Number(t.value) / 1_000_000).toFixed(2),
        isToTreasury: t.to === treasury,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch tx" },
      { status: 500 }
    );
  }
}
