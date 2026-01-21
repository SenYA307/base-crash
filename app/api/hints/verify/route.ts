import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import {
  verifyIntentToken,
  verifyUsdcPurchase,
  HINTS_PACK_SIZE,
} from "@/lib/hints";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // NO auth token required - we verify via intent token + USDC Transfer event
    const body = await request.json();
    const { intentToken, txHash } = body;

    if (!intentToken || !txHash) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify intent token
    const intent = verifyIntentToken(intentToken);
    if (!intent) {
      return NextResponse.json(
        { error: "Invalid or expired intent" },
        { status: 400 }
      );
    }

    const debugPay = process.env.DEBUG_PAY === "1";
    if (debugPay) {
      console.log("[DEBUG_PAY] Verifying USDC purchase", {
        txHash: txHash.slice(0, 12) + "...",
        treasury: intent.treasuryAddress.slice(0, 12) + "...",
        requiredUsdc: intent.requiredUsdc,
        tokenAddress: intent.tokenAddress,
      });
    }

    // Verify USDC Transfer to treasury
    console.log(`[verify] USDC verification for ${txHash.slice(0, 12)}...`);
    const verification = await verifyUsdcPurchase({
      txHash,
      expectedTreasury: intent.treasuryAddress,
      minAmount: BigInt(intent.requiredUsdc),
    });

    // Handle pending (not enough confirmations yet)
    if (verification.status === "pending") {
      return NextResponse.json(
        {
          ok: false,
          status: "pending",
          reason: "not_enough_confirmations",
          confirmations: verification.confirmations,
          requiredConfirmations: verification.required,
        },
        { status: 202 }
      );
    }

    // Handle invalid
    if (verification.status === "invalid") {
      // Log detailed error info for debugging
      console.log(`[verify] Invalid tx ${txHash.slice(0, 10)}...: ${verification.error}`, {
        reason: verification.reason,
        expected: verification.expected?.slice(0, 12),
        actual: verification.actual?.slice(0, 12),
      });

      return NextResponse.json(
        {
          error: verification.error,
          reason: verification.reason,
          txHash,
          // Include expected/actual for client-side display if needed
          ...(verification.reason === "wrong_recipient" && {
            expected: verification.expected,
            actual: verification.actual,
          }),
          ...(verification.reason === "transfer_not_found" && {
            tokenAddress: intent.tokenAddress,
            treasuryAddress: intent.treasuryAddress,
          }),
          ...(verification.reason === "insufficient_payment" && {
            requiredUsdc: verification.expected,
            gotUsdc: verification.actual,
          }),
        },
        { status: 400 }
      );
    }

    // Use buyer from Transfer event (authoritative)
    const actualSender = verification.buyer;
    console.log(`[verify] Tx ${txHash.slice(0, 10)}... buyer ${actualSender.slice(0, 10)}... amount ${verification.amount.toString()}`);

    const db = await getDb();

    // Check if txHash already used
    const existingResult = await db.execute({
      sql: "SELECT id, address, run_id, added_hints FROM hint_purchases WHERE tx_hash = ?",
      args: [txHash.toLowerCase()],
    });
    const existingRow = existingResult.rows[0];
    const existing = existingRow
      ? {
          id: Number(existingRow.id ?? existingRow["id"] ?? 0),
          address: String(existingRow.address ?? existingRow["address"] ?? ""),
          run_id: String(existingRow.run_id ?? existingRow["run_id"] ?? ""),
          added_hints: Number(
            existingRow.added_hints ?? existingRow["added_hints"] ?? 0
          ),
        }
      : undefined;

    if (existing) {
      // Check if this was the same sender and run (retry of already-processed purchase)
      if (
        existing.address === actualSender &&
        existing.run_id === intent.runId
      ) {
        // Already verified for this sender/run - return success
        const totalResult = await db.execute({
          sql: `SELECT SUM(added_hints) as total FROM hint_purchases
                WHERE address = ? AND run_id = ?`,
          args: [actualSender, intent.runId],
        });
        const totalRow = totalResult.rows[0];

        return NextResponse.json({
          ok: true,
          alreadyProcessed: true,
          addedHints: 0,
          purchasedHints: Number(
            totalRow?.total ?? totalRow?.["total"] ?? 0
          ),
          actualSender,
          message: "Already verified",
        });
      }

      // Different sender or run - actual replay attempt
      return NextResponse.json(
        { error: "Transaction already used for a different purchase" },
        { status: 400 }
      );
    }

    // Record the purchase using actual sender (avoid UNIQUE constraint crashes)
    const createdAt = Math.floor(Date.now() / 1000);
    const insertResult = await db.execute({
      sql: `INSERT OR IGNORE INTO hint_purchases (address, run_id, tx_hash, added_hints, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        actualSender,
        intent.runId,
        txHash.toLowerCase(),
        HINTS_PACK_SIZE,
        createdAt,
      ],
    });

    // If insert was ignored, check who owns the tx_hash
    if ((insertResult.rowsAffected ?? 0) === 0) {
      const existingTxResult = await db.execute({
        sql: "SELECT address, run_id FROM hint_purchases WHERE tx_hash = ?",
        args: [txHash.toLowerCase()],
      });
      const existingTxRow = existingTxResult.rows[0];
      const existingTx = existingTxRow
        ? {
            address: String(
              existingTxRow.address ?? existingTxRow["address"] ?? ""
            ),
            run_id: String(
              existingTxRow.run_id ?? existingTxRow["run_id"] ?? ""
            ),
          }
        : undefined;

      if (
        existingTx &&
        existingTx.address === actualSender &&
        existingTx.run_id === intent.runId
      ) {
        return NextResponse.json({
          ok: true,
          alreadyProcessed: true,
          addedHints: 0,
          actualSender,
        });
      }

      return NextResponse.json(
        { ok: false, reason: "tx_already_used" },
        { status: 400 }
      );
    }

    // Calculate remaining hints for this run using actual sender
    const result = await db.execute({
      sql: `SELECT SUM(added_hints) as total FROM hint_purchases
            WHERE address = ? AND run_id = ?`,
      args: [actualSender, intent.runId],
    });
    const purchasedHints = Number(
      result.rows[0]?.total ?? result.rows[0]?.["total"] ?? 0
    );

    return NextResponse.json({
      ok: true,
      addedHints: HINTS_PACK_SIZE,
      purchasedHints,
      buyer: actualSender,
      paidUsdc: verification.amount.toString(),
    });
  } catch (error) {
    console.error("[verify] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    
    // Return structured error, never crash
    return NextResponse.json(
      {
        ok: false,
        error: "Verification error",
        reason: "exception",
        message: message.slice(0, 200), // Limit error message length
      },
      { status: 500 }
    );
  }
}
