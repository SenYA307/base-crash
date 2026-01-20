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

export async function POST(request: NextRequest) {
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
    const todayStart = getUTCDayStart();
    const yesterdayStart = todayStart - 86400000; // 24 hours in ms
    const now = Date.now();

    // Get current state
    const result = await db.execute({
      sql: "SELECT streak, last_checkin_utc FROM gm_streaks WHERE address = ?",
      args: [userId],
    });

    let currentStreak = 0;
    let lastCheckInUtc = 0;

    if (result.rows.length > 0) {
      currentStreak = Number(result.rows[0].streak ?? 0);
      lastCheckInUtc = Number(result.rows[0].last_checkin_utc ?? 0);
    }

    // Check if already checked in today
    if (lastCheckInUtc >= todayStart) {
      return NextResponse.json({
        error: "Already checked in today",
        streak: currentStreak,
        canCheckIn: false,
        lastCheckInUtc,
        nextResetUtc: getNextUTCMidnight(),
      }, { status: 400 });
    }

    // Calculate new streak
    let newStreak: number;
    if (lastCheckInUtc >= yesterdayStart && lastCheckInUtc < todayStart) {
      // Checked in yesterday - increment streak
      newStreak = currentStreak + 1;
    } else {
      // Missed a day or first check-in - reset to 1
      newStreak = 1;
    }

    // Upsert the record
    await db.execute({
      sql: `INSERT INTO gm_streaks (address, streak, last_checkin_utc)
            VALUES (?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
              streak = excluded.streak,
              last_checkin_utc = excluded.last_checkin_utc`,
      args: [userId, newStreak, now],
    });

    return NextResponse.json({
      success: true,
      streak: newStreak,
      canCheckIn: false,
      lastCheckInUtc: now,
      nextResetUtc: getNextUTCMidnight(),
    });
  } catch (error) {
    console.error("[gm/checkin] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
