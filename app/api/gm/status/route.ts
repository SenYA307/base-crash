import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function getUTCDayStart(date: Date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
}

function getNextUTCMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return tomorrow.getTime();
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const payload = verifyAuthToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const db = await getDb();
    // Support both wallet auth (address) and Quick Auth (fid)
    const userId = payload.address?.toLowerCase() || (payload.fid ? `fid:${payload.fid}` : null);
    if (!userId) {
      return NextResponse.json({ error: "No user identifier in token" }, { status: 401 });
    }

    const result = await db.execute({
      sql: "SELECT streak, last_checkin_utc FROM gm_streaks WHERE address = ?",
      args: [userId],
    });

    const todayStart = getUTCDayStart();
    const nextResetUtc = getNextUTCMidnight();

    if (result.rows.length === 0) {
      return NextResponse.json({
        streak: 0,
        canCheckIn: true,
        lastCheckInUtc: 0,
        nextResetUtc,
      });
    }

    const row = result.rows[0];
    const streak = Number(row.streak ?? 0);
    const lastCheckInUtc = Number(row.last_checkin_utc ?? 0);

    // Can check in if last check-in was before today's UTC start
    const canCheckIn = lastCheckInUtc < todayStart;

    return NextResponse.json({
      streak,
      canCheckIn,
      lastCheckInUtc,
      nextResetUtc,
    });
  } catch (error) {
    console.error("[gm/status] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
