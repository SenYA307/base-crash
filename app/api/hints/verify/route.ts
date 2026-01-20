import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { verifyIntentToken, verifyTransaction, HINTS_PACK_SIZE } from "@/lib/hints";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // NO auth token required - we verify via intent token + on-chain tx.from
    // Parse body
    const body = await request.json();
    const { intentToken, txHash, address } = body;

    if (!intentToken || !txHash || !address) {
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

    // Verify address in request matches intent address
    // On-chain verification will also check tx.from matches
    if (intent.address.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ error: "Address mismatch with intent" }, { status: 400 });
    }

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
      // Check if this was the same user and run (retry of already-processed purchase)
      if (
        existing.address === address.toLowerCase() &&
        existing.run_id === intent.runId
      ) {
        // Already verified for this user/run - return success
        const totalResult = await db.execute({
          sql: `SELECT SUM(added_hints) as total FROM hint_purchases
                WHERE address = ? AND run_id = ?`,
          args: [address.toLowerCase(), intent.runId],
        });
        const totalRow = totalResult.rows[0];

        return NextResponse.json({
          ok: true,
          alreadyProcessed: true,
          addedHints: 0,
          purchasedHints: Number(
            totalRow?.total ?? totalRow?.["total"] ?? 0
          ),
          message: "Already verified",
        });
      }

      // Different user or run - actual replay attempt
      return NextResponse.json(
        { error: "Transaction already used for a different purchase" },
        { status: 400 }
      );
    }

    // Verify transaction on chain
    const verification = await verifyTransaction({
      txHash,
      expectedFrom: address,
      expectedTo: intent.treasuryAddress,
      minValue: BigInt(intent.requiredWei),
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
      return NextResponse.json(
        { error: verification.error },
        { status: 400 }
      );
    }

    // Record the purchase (avoid UNIQUE constraint crashes)
    const createdAt = Math.floor(Date.now() / 1000);
    const insertResult = await db.execute({
      sql: `INSERT OR IGNORE INTO hint_purchases (address, run_id, tx_hash, added_hints, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        address.toLowerCase(),
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
        existingTx.address === address.toLowerCase() &&
        existingTx.run_id === intent.runId
      ) {
        return NextResponse.json({
          ok: true,
          alreadyProcessed: true,
          addedHints: 0,
        });
      }

      return NextResponse.json(
        { ok: false, reason: "tx_already_used" },
        { status: 400 }
      );
    }

    // Calculate remaining hints for this run
    const result = await db.execute({
      sql: `SELECT SUM(added_hints) as total FROM hint_purchases
            WHERE address = ? AND run_id = ?`,
      args: [address.toLowerCase(), intent.runId],
    });
    const purchasedHints = Number(
      result.rows[0]?.total ?? result.rows[0]?.["total"] ?? 0
    );

    return NextResponse.json({
      ok: true,
      addedHints: HINTS_PACK_SIZE,
      purchasedHints,
    });
  } catch (error) {
    console.error("[verify] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
