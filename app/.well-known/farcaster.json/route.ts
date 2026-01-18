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
      description: "Base Crash mini app game.",
      iconUrl: `${origin}/assets/miniapp/icon.png`,
      splashImageUrl: `${origin}/assets/miniapp/splash.svg`,
      splashBackgroundColor: "#0b1020",
      homeUrl: origin,
      primaryCategory: "games",
      tags: ["match3", "base", "arcade", "crypto", "game"],
    },
    ...(hasAssociation ? {} : { noindex: true }),
  });
}
