import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuthToken } from "@/lib/auth";

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
    const score = body?.score;
    const durationMs = body?.durationMs;
    const movesUsed = body?.movesUsed;
    const hintsUsed = body?.hintsUsed ?? null;
    const gameVersion = body?.gameVersion ?? null;

    if (!Number.isInteger(score) || score < 0) {
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

    const address = payload.address.toLowerCase();
    const now = Date.now();
    const lastSubmit = lastSubmitByAddress.get(address) || 0;
    if (now - lastSubmit < RATE_LIMIT_MS) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
    lastSubmitByAddress.set(address, now);

    const db = await getDb();
    const createdAt = Math.floor(Date.now() / 1000);
    await db.execute({
      sql: `INSERT INTO scores (address, score, created_at, game_version, duration_ms, moves_used, hints_used)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        address,
        score,
        createdAt,
        gameVersion,
        durationMs,
        movesUsed,
        hintsUsed,
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
