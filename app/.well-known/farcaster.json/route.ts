import "@/lib/env";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const header = process.env.MINIAPP_ASSOC_HEADER;
  const payload = process.env.MINIAPP_ASSOC_PAYLOAD;
  const signature = process.env.MINIAPP_ASSOC_SIGNATURE;

  const hasAssociation = Boolean(header && payload && signature);
  if (!hasAssociation && process.env.NODE_ENV !== "production") {
    console.warn(
      "[miniapp] MINIAPP_ASSOC_* env vars missing; returning placeholder association"
    );
  }

  return NextResponse.json({
    accountAssociation: {
      header: header || "",
      payload: payload || "",
      signature: signature || "",
    },
    miniapp: {
      version: "1",
      name: "Base Crash",
      subtitle: "Match3 on Base",
      description: "Base Crash mini app game.",
      tagline: "Match3. Combo. Win.",
      iconUrl: `${origin}/assets/miniapp/icon.png`,
      splashImageUrl: `${origin}/assets/miniapp/splash.svg`,
      splashBackgroundColor: "#0b1020",
      homeUrl: origin,
      primaryCategory: "games",
      tags: ["match3", "base", "arcade", "crypto", "game"],
      // OG metadata
      ogTitle: "Base Crash",
      ogDescription: "Match-3 on Base. Combos, streaks, leaderboard.",
      ogImageUrl: `${origin}/assets/miniapp/og.png`,
      // Hero image (same as OG)
      heroImageUrl: `${origin}/assets/miniapp/hero.png`,
      // Screenshots (portrait 1284x2778)
      screenshotUrls: [
        `${origin}/assets/miniapp/s1.png`,
        `${origin}/assets/miniapp/s2.png`,
        `${origin}/assets/miniapp/s3.png`,
      ],
      // Webhook for notifications (stub endpoint)
      webhookUrl: `${origin}/api/webhook`,
      // Indexing
      noindex: true,
    },
  });
}
