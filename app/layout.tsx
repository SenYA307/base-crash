import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WagmiProviderClient from "@/components/WagmiProviderClient";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

export const metadata: Metadata = {
  title: "Base Crash",
  description: "Match-3 on Base. Combos, streaks, leaderboard.",
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: "Base Crash",
    description: "Match-3 on Base. Combos, streaks, leaderboard.",
    url: APP_URL,
    images: ["/assets/miniapp/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Base Crash",
    description: "Match-3 on Base. Combos, streaks, leaderboard.",
    images: ["/assets/miniapp/og.png"],
  },
  other: {
    "base:app_id": "696cfddff22fe462e74c1384",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="base:app_id" content="696cfddff22fe462e74c1384" />
        <meta property="fc:miniapp" content="true" />
        <meta
          property="fc:miniapp:manifest"
          content={`${APP_URL}/.well-known/farcaster.json`}
        />
        <meta property="og:title" content="Base Crash" />
        <meta
          property="og:description"
          content="Match-3 on Base. Combos, streaks, leaderboard."
        />
        <meta property="og:image" content={`${APP_URL}/assets/miniapp/og.png`} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WagmiProviderClient>{children}</WagmiProviderClient>
      </body>
    </html>
  );
}
