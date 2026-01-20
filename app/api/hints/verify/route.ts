import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import {
  verifyIntentToken,
  verifyTransaction,
  verifyContractPurchase,
  getHintsContractAddress,
  HINTS_PACK_SIZE,
  runIdToBytes32,
} from "@/lib/hints";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // NO auth token required - we verify via intent token + on-chain event/tx
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

    const contractAddress = intent.contractAddress || getHintsContractAddress();
    let verification;
    const debugPay = process.env.DEBUG_PAY === "1";

    // Prefer contract-based verification if contract is configured
    if (contractAddress) {
      console.log(`[verify] Using contract verification: ${contractAddress.slice(0, 10)}...`);
      if (debugPay) {
        console.log("[DEBUG_PAY] Contract mode enabled", {
          contractAddress,
          intentRunId: intent.runId,
          intentRunIdBytes32: intent.runIdBytes32,
        });
      }
      const expectedRunIdBytes32 = intent.runIdBytes32
        ? intent.runIdBytes32
        : runIdToBytes32(intent.runId);
      verification = await verifyContractPurchase({
        txHash,
        expectedRunIdBytes32,
        minValue: BigInt(intent.requiredWei),
      });
    } else {
      // Fallback to legacy direct transfer verification
      console.log("[verify] Using legacy transfer verification (no contract configured)");
      verification = await verifyTransaction({
        txHash,
        expectedTo: intent.treasuryAddress,
        minValue: BigInt(intent.requiredWei),
      });
    }

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
        hint: verification.hint,
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
          ...(verification.reason === "event_not_found" && {
            contractAddress: verification.expected,
          }),
          ...(verification.reason === "runid_mismatch" && {
            expectedRunIdBytes32: verification.expected,
            gotRunIdBytes32: verification.actual,
          }),
          ...(verification.reason === "insufficient_payment" && {
            requiredWei: verification.expected,
            gotWei: verification.actual,
          }),
          // Include hint for AA wallets without API key
          ...(verification.reason === "aa_internal_transfer_unverified" && {
            hint: verification.hint,
            isSmartWallet: true,
          }),
        },
        { status: 400 }
      );
    }

    // Use buyer from event (if available) or tx.from as authoritative
    const actualSender = verification.buyer || verification.actualFrom;
    const usedEvent = verification.usedEvent || false;
    console.log(`[verify] Tx ${txHash.slice(0, 10)}... buyer ${actualSender.slice(0, 10)}... (event: ${usedEvent})`);

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
      actualSender,
      usedEvent,
      usedInternalTransfer: verification.usedInternalTransfer || false,
    });
  } catch (error) {
    console.error("[verify] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
