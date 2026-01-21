import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDayStartUtc, getWeekStartUtc, getWeekEndUtc } from "@/lib/referral";

export const runtime = "nodejs";

type Mode = "daily" | "weekly" | "alltime";

type LeaderboardRow = {
  address: string;
  score: number;
  created_at: number;
};

/**
 * Run leaderboard query with fallback for schema compatibility.
 * First tries with final_score column, falls back to score-only if column doesn't exist.
 */
async function runLeaderboardQuery(
  db: Awaited<ReturnType<typeof getDb>>,
  mode: Mode,
  limit: number,
  now: Date
): Promise<LeaderboardRow[]> {
  // Try with new columns first
  const newScoreExpr = "COALESCE(final_score, score)";
  
  try {
    let result;
    if (mode === "daily") {
      const start = getDayStartUtc(now);
      result = await db.execute({
        sql: `SELECT address, ${newScoreExpr} as score, created_at
              FROM scores
              WHERE created_at >= ?
              ORDER BY ${newScoreExpr} DESC, created_at ASC
              LIMIT ?`,
        args: [start, limit],
      });
    } else if (mode === "weekly") {
      const weekStart = getWeekStartUtc(now);
      const weekEnd = getWeekEndUtc(now);
      result = await db.execute({
        sql: `SELECT address, ${newScoreExpr} as score, created_at
              FROM scores
              WHERE created_at >= ? AND created_at <= ?
              ORDER BY ${newScoreExpr} DESC, created_at ASC
              LIMIT ?`,
        args: [weekStart, weekEnd, limit],
      });
    } else {
      result = await db.execute({
        sql: `SELECT address, ${newScoreExpr} as score, created_at
              FROM scores
              ORDER BY ${newScoreExpr} DESC, created_at ASC
              LIMIT ?`,
        args: [limit],
      });
    }
    return result.rows.map((row) => ({
      address: String(row.address),
      score: Number(row.score ?? 0),
      created_at: Number(row.created_at),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If column doesn't exist, fall back to legacy query
    if (message.includes("no such column") || message.includes("final_score")) {
      console.log("[leaderboard] Falling back to legacy query (no final_score column)");
      return runLegacyQuery(db, mode, limit, now);
    }
    throw err;
  }
}

/**
 * Legacy query using only score column.
 */
async function runLegacyQuery(
  db: Awaited<ReturnType<typeof getDb>>,
  mode: Mode,
  limit: number,
  now: Date
): Promise<LeaderboardRow[]> {
  let result;
  if (mode === "daily") {
    const start = getDayStartUtc(now);
    result = await db.execute({
      sql: `SELECT address, score, created_at
            FROM scores
            WHERE created_at >= ?
            ORDER BY score DESC, created_at ASC
            LIMIT ?`,
      args: [start, limit],
    });
  } else if (mode === "weekly") {
    const weekStart = getWeekStartUtc(now);
    const weekEnd = getWeekEndUtc(now);
    result = await db.execute({
      sql: `SELECT address, score, created_at
            FROM scores
            WHERE created_at >= ? AND created_at <= ?
            ORDER BY score DESC, created_at ASC
            LIMIT ?`,
      args: [weekStart, weekEnd, limit],
    });
  } else {
    result = await db.execute({
      sql: `SELECT address, score, created_at
            FROM scores
            ORDER BY score DESC, created_at ASC
            LIMIT ?`,
      args: [limit],
    });
  }
  return result.rows.map((row) => ({
    address: String(row.address),
    score: Number(row.score ?? 0),
    created_at: Number(row.created_at),
  }));
}

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

    const rows = await runLeaderboardQuery(db, mode, limit, now);

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
