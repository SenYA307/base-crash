import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDayStartUtc, getWeekStartUtc, getWeekEndUtc } from "@/lib/referral";

export const runtime = "nodejs";

type Mode = "daily" | "weekly" | "alltime";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "alltime") as Mode;
    const limitParam = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isNaN(limitParam)
      ? 50
      : Math.max(1, Math.min(100, limitParam));

    const db = await getDb();
    const now = new Date();

    // Use COALESCE to fall back to score if final_score is null (for old entries)
    const scoreColumn = "COALESCE(final_score, score)";

    let rows: { address: string; score: number; created_at: number; raw_score: number | null }[] = [];

    if (mode === "daily") {
      const start = getDayStartUtc(now);
      const result = await db.execute({
        sql: `SELECT address, ${scoreColumn} as score, raw_score, created_at
              FROM scores
              WHERE created_at >= ?
              ORDER BY ${scoreColumn} DESC, created_at ASC
              LIMIT ?`,
        args: [start, limit],
      });
      rows = result.rows.map((row) => ({
        address: String(row.address),
        score: Number(row.score),
        raw_score: row.raw_score != null ? Number(row.raw_score) : null,
        created_at: Number(row.created_at),
      }));
    } else if (mode === "weekly") {
      const weekStart = getWeekStartUtc(now);
      const weekEnd = getWeekEndUtc(now);
      const result = await db.execute({
        sql: `SELECT address, ${scoreColumn} as score, raw_score, created_at
              FROM scores
              WHERE created_at >= ? AND created_at <= ?
              ORDER BY ${scoreColumn} DESC, created_at ASC
              LIMIT ?`,
        args: [weekStart, weekEnd, limit],
      });
      rows = result.rows.map((row) => ({
        address: String(row.address),
        score: Number(row.score),
        raw_score: row.raw_score != null ? Number(row.raw_score) : null,
        created_at: Number(row.created_at),
      }));
    } else {
      // alltime
      const result = await db.execute({
        sql: `SELECT address, ${scoreColumn} as score, raw_score, created_at
              FROM scores
              ORDER BY ${scoreColumn} DESC, created_at ASC
              LIMIT ?`,
        args: [limit],
      });
      rows = result.rows.map((row) => ({
        address: String(row.address),
        score: Number(row.score),
        raw_score: row.raw_score != null ? Number(row.raw_score) : null,
        created_at: Number(row.created_at),
      }));
    }

    const withRank = rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    }));

    // Get week boundaries for display
    const weekInfo = mode === "weekly" ? {
      weekStart: getWeekStartUtc(now),
      weekEnd: getWeekEndUtc(now),
    } : undefined;

    return NextResponse.json({
      mode,
      results: withRank,
      ...(weekInfo && { weekInfo }),
    });
  } catch (error) {
    console.error("[leaderboard] Error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
