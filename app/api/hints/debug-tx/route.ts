import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  parseHintsPurchasedEvents,
  getHintsContractAddress,
  runIdToBytes32,
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
  const runId = request.nextUrl.searchParams.get("runId");
  const runIdBytes32Param = request.nextUrl.searchParams.get("runIdBytes32");

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

    const events = receipt?.logs ? parseHintsPurchasedEvents(receipt.logs) : [];
    const expectedRunIdBytes32 =
      runIdBytes32Param || (runId ? runIdToBytes32(runId) : null);

    return NextResponse.json({
      txHash,
      txTo: tx?.to || null,
      receiptTo: receipt?.to || null,
      contractAddress: getHintsContractAddress(),
      expectedRunIdBytes32,
      foundEvents: events.map((e) => ({
        buyer: e.buyer,
        runId: e.runId,
        amountWei: e.amountWei.toString(),
        hints: e.hints.toString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch tx" },
      { status: 500 }
    );
  }
}
