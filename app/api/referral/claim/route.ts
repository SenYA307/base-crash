import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

    // Get user ID (invitee)
    const inviteeUserId = payload.address?.toLowerCase() || (payload.fid ? `fid:${payload.fid}` : null);
    if (!inviteeUserId) {
      return NextResponse.json(
        { error: "User identity not found" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Referral code is required" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = Math.floor(Date.now() / 1000);

    // Check if user is already referred
    const existingRef = await db.execute({
      sql: "SELECT inviter_user_id FROM referrals WHERE invitee_user_id = ?",
      args: [inviteeUserId],
    });

    if (existingRef.rows.length > 0) {
      return NextResponse.json(
        { error: "You have already been referred", alreadyReferred: true },
        { status: 400 }
      );
    }

    // Look up the referral code
    const codeRow = await db.execute({
      sql: "SELECT user_id FROM referral_codes WHERE code = ?",
      args: [code.toUpperCase()],
    });

    if (codeRow.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid referral code" },
        { status: 400 }
      );
    }

    const inviterUserId = String(codeRow.rows[0].user_id);

    // Prevent self-referral
    if (inviterUserId === inviteeUserId) {
      return NextResponse.json(
        { error: "Cannot use your own referral code" },
        { status: 400 }
      );
    }

    // Create the referral binding (not yet activated)
    await db.execute({
      sql: "INSERT INTO referrals (inviter_user_id, invitee_user_id, created_at) VALUES (?, ?, ?)",
      args: [inviterUserId, inviteeUserId, now],
    });

    return NextResponse.json({
      ok: true,
      message: "Referral claimed! Your inviter will receive a boost after you complete a game.",
      inviterUserId,
    });
  } catch (error) {
    console.error("[referral/claim] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
