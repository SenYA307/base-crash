import "@/lib/env";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const header = process.env.MINIAPP_ASSOC_HEADER;
  const payload = process.env.MINIAPP_ASSOC_PAYLOAD;
  const signature = process.env.MINIAPP_ASSOC_SIGNATURE;

  if (!header || !payload || !signature) {
    return NextResponse.json(
      { error: "Miniapp account association env vars are missing" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    accountAssociation: {
      header,
      payload,
      signature,
    },
    miniapp: {
      version: "1",
      name: "Base Crash",
      description: "Base Crash mini app game.",
      iconUrl: `${origin}/assets/miniapp/icon.svg`,
      splashImageUrl: `${origin}/assets/miniapp/splash.svg`,
      splashBackgroundColor: "#0b1020",
      homeUrl: origin,
    },
  });
}
