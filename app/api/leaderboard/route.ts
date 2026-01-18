import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type Mode = "daily" | "alltime";

function getUtcMidnightTimestamp() {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0
  );
  return Math.floor(utcMidnight / 1000);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "alltime") as Mode;
    const limitParam = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isNaN(limitParam)
      ? 50
      : Math.max(1, Math.min(50, limitParam));

    const db = await getDb();

    let rows: { address: string; score: number; created_at: number }[] = [];
    if (mode === "daily") {
      const start = getUtcMidnightTimestamp();
      const result = await db.execute({
        sql: `SELECT address, score, created_at
              FROM scores
              WHERE created_at >= ?
              ORDER BY score DESC, created_at ASC
              LIMIT ?`,
        args: [start, limit],
      });
      rows = result.rows.map((row) => ({
        address: String(row.address),
        score: Number(row.score),
        created_at: Number(row.created_at),
      }));
    } else {
      const result = await db.execute({
        sql: `SELECT address, score, created_at
              FROM scores
              ORDER BY score DESC, created_at ASC
              LIMIT ?`,
        args: [limit],
      });
      rows = result.rows.map((row) => ({
        address: String(row.address),
        score: Number(row.score),
        created_at: Number(row.created_at),
      }));
    }

    const withRank = rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    }));

    return NextResponse.json({ mode, results: withRank });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
