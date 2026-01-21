import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuthToken } from "@/lib/auth";
import {
  applyBoost,
  calculateBoostMultiplier,
  getBoostExpirationTimestamp,
} from "@/lib/referral";

export const runtime = "nodejs";

const RATE_LIMIT_MS = 3000;
const lastSubmitByAddress = new Map<string, number>();

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const rawScore = body?.score;
    const durationMs = body?.durationMs;
    const movesUsed = body?.movesUsed;
    const hintsUsed = body?.hintsUsed ?? null;
    const gameVersion = body?.gameVersion ?? null;

    if (!Number.isInteger(rawScore) || rawScore < 0) {
      return NextResponse.json({ error: "Invalid score" }, { status: 400 });
    }
    if (
      !Number.isInteger(durationMs) ||
      durationMs < 5000 ||
      durationMs > 30 * 60 * 1000
    ) {
      return NextResponse.json(
        { error: "Invalid durationMs" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(movesUsed) || movesUsed < 0 || movesUsed > 30) {
      return NextResponse.json(
        { error: "Invalid movesUsed" },
        { status: 400 }
      );
    }
    if (hintsUsed !== null && !Number.isInteger(hintsUsed)) {
      return NextResponse.json(
        { error: "Invalid hintsUsed" },
        { status: 400 }
      );
    }

    // Support both wallet auth (address) and Quick Auth (fid)
    const userId = payload.address?.toLowerCase() || (payload.fid ? `fid:${payload.fid}` : null);
    if (!userId) {
      return NextResponse.json({ error: "No user identifier in token" }, { status: 401 });
    }

    const nowMs = Date.now();
    const lastSubmit = lastSubmitByAddress.get(userId) || 0;
    if (nowMs - lastSubmit < RATE_LIMIT_MS) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
    lastSubmitByAddress.set(userId, nowMs);

    const db = await getDb();
    const createdAt = Math.floor(nowMs / 1000);

    // Check if this is the user's first score submission (for referral activation)
    const existingScores = await db.execute({
      sql: "SELECT COUNT(*) as count FROM scores WHERE address = ?",
      args: [userId],
    });
    const isFirstSubmission = Number(existingScores.rows[0]?.count ?? 0) === 0;

    // If first submission, activate any pending referral (inviter gets boost)
    if (isFirstSubmission) {
      const referral = await db.execute({
        sql: "SELECT inviter_user_id FROM referrals WHERE invitee_user_id = ? AND activated_at IS NULL",
        args: [userId],
      });

      if (referral.rows.length > 0) {
        const inviterUserId = String(referral.rows[0].inviter_user_id);

        // Activate the referral
        await db.execute({
          sql: "UPDATE referrals SET activated_at = ? WHERE invitee_user_id = ?",
          args: [createdAt, userId],
        });

        // Count inviter's activated referrals
        const activatedCount = await db.execute({
          sql: "SELECT COUNT(*) as count FROM referrals WHERE inviter_user_id = ? AND activated_at IS NOT NULL",
          args: [inviterUserId],
        });
        const count = Number(activatedCount.rows[0]?.count ?? 1);

        // Calculate and update inviter's boost
        const newMultiplier = calculateBoostMultiplier(count);
        const expiresAt = getBoostExpirationTimestamp();

        await db.execute({
          sql: `INSERT INTO referral_boosts (user_id, multiplier, expires_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  multiplier = MAX(excluded.multiplier, referral_boosts.multiplier),
                  expires_at = MAX(excluded.expires_at, referral_boosts.expires_at),
                  updated_at = excluded.updated_at`,
          args: [inviterUserId, newMultiplier, expiresAt, createdAt],
        });

        console.log(`[score/submit] Activated referral: ${userId} -> ${inviterUserId}, boost: ${newMultiplier}x`);
      }
    }

    // Get the submitter's current boost (if any)
    const boostRow = await db.execute({
      sql: "SELECT multiplier FROM referral_boosts WHERE user_id = ? AND expires_at > ?",
      args: [userId, createdAt],
    });
    const boostMultiplier = boostRow.rows.length > 0
      ? Number(boostRow.rows[0].multiplier)
      : 1.0;

    // Apply boost to calculate final score
    const finalScore = applyBoost(rawScore, boostMultiplier);

    // Store both raw and final scores
    await db.execute({
      sql: `INSERT INTO scores (address, score, raw_score, final_score, boost_multiplier, created_at, game_version, duration_ms, moves_used, hints_used)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        finalScore, // "score" column for backward compatibility
        rawScore,
        finalScore,
        boostMultiplier,
        createdAt,
        gameVersion,
        durationMs,
        movesUsed,
        hintsUsed,
      ],
    });

    return NextResponse.json({
      success: true,
      rawScore,
      finalScore,
      boostApplied: boostMultiplier > 1.0,
      boostMultiplier,
    });
  } catch (error) {
    console.error("[score/submit] Error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
