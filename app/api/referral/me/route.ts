import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { generateReferralCode } from "@/lib/referral";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get user ID (fid or address)
    const userId = payload.address?.toLowerCase() || (payload.fid ? `fid:${payload.fid}` : null);
    if (!userId) {
      return NextResponse.json(
        { error: "User identity not found" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = Math.floor(Date.now() / 1000);

    // Get or create referral code
    let codeRow = await db.execute({
      sql: "SELECT code FROM referral_codes WHERE user_id = ?",
      args: [userId],
    });

    let code: string;
    if (codeRow.rows.length === 0) {
      // Generate and store code
      code = generateReferralCode(userId);
      await db.execute({
        sql: "INSERT INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)",
        args: [userId, code, now],
      });
    } else {
      code = String(codeRow.rows[0].code);
    }

    // Get referral stats
    const totalReferrals = await db.execute({
      sql: "SELECT COUNT(*) as count FROM referrals WHERE inviter_user_id = ?",
      args: [userId],
    });

    const activatedReferrals = await db.execute({
      sql: "SELECT COUNT(*) as count FROM referrals WHERE inviter_user_id = ? AND activated_at IS NOT NULL",
      args: [userId],
    });

    // Get current boost
    const boostRow = await db.execute({
      sql: "SELECT multiplier, expires_at FROM referral_boosts WHERE user_id = ? AND expires_at > ?",
      args: [userId, now],
    });

    const boost = boostRow.rows.length > 0
      ? {
          multiplier: Number(boostRow.rows[0].multiplier),
          expiresAt: Number(boostRow.rows[0].expires_at),
        }
      : null;

    // Get inviter (if this user was referred)
    const inviterRow = await db.execute({
      sql: "SELECT inviter_user_id, activated_at FROM referrals WHERE invitee_user_id = ?",
      args: [userId],
    });

    const invitedBy = inviterRow.rows.length > 0
      ? {
          inviterId: String(inviterRow.rows[0].inviter_user_id),
          activatedAt: inviterRow.rows[0].activated_at
            ? Number(inviterRow.rows[0].activated_at)
            : null,
        }
      : null;

    return NextResponse.json({
      code,
      userId,
      stats: {
        totalReferrals: Number(totalReferrals.rows[0]?.count ?? 0),
        activatedReferrals: Number(activatedReferrals.rows[0]?.count ?? 0),
      },
      boost,
      invitedBy,
    });
  } catch (error) {
    console.error("[referral/me] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
