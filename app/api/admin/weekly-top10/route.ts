import "@/lib/env";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getWeekStartUtc, getWeekEndUtc } from "@/lib/referral";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    // Verify admin key
    const adminKey = request.headers.get("X-Admin-Key");
    const expectedKey = process.env.ADMIN_KEY;

    if (!expectedKey) {
      return NextResponse.json(
        { error: "Admin endpoint not configured" },
        { status: 503 }
      );
    }

    if (adminKey !== expectedKey) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get("weekStartUtc");

    let weekStart: number;
    let weekEnd: number;

    if (weekStartParam) {
      // Use provided week start
      weekStart = parseInt(weekStartParam, 10);
      if (isNaN(weekStart)) {
        return NextResponse.json(
          { error: "Invalid weekStartUtc parameter" },
          { status: 400 }
        );
      }
      // Calculate week end (7 days - 1 second)
      weekEnd = weekStart + (7 * 24 * 60 * 60) - 1;
    } else {
      // Use current week
      const now = new Date();
      weekStart = getWeekStartUtc(now);
      weekEnd = getWeekEndUtc(now);
    }

    const db = await getDb();

    // Get top 10 for the week
    const scoreColumn = "COALESCE(final_score, score)";
    const result = await db.execute({
      sql: `SELECT 
              address as user_id,
              ${scoreColumn} as final_score,
              raw_score,
              boost_multiplier,
              created_at
            FROM scores
            WHERE created_at >= ? AND created_at <= ?
            ORDER BY ${scoreColumn} DESC, created_at ASC
            LIMIT 10`,
      args: [weekStart, weekEnd],
    });

    const top10 = result.rows.map((row, index) => ({
      rank: index + 1,
      userId: String(row.user_id),
      finalScore: Number(row.final_score),
      rawScore: row.raw_score != null ? Number(row.raw_score) : null,
      boostMultiplier: row.boost_multiplier != null ? Number(row.boost_multiplier) : 1.0,
      timestamp: Number(row.created_at),
    }));

    return NextResponse.json({
      weekStart,
      weekEnd,
      weekStartIso: new Date(weekStart * 1000).toISOString(),
      weekEndIso: new Date(weekEnd * 1000).toISOString(),
      top10,
    });
  } catch (error) {
    console.error("[admin/weekly-top10] Error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
