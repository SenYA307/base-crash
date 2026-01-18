# Base Crash

Base Crash is a Base Mini App match-3 game with wallet auth, leaderboard, and hint purchases.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Environment Variables

Set these in Vercel (Project → Settings → Environment Variables):

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
AUTH_TOKEN_SECRET=
HINTS_PAYMENT_SECRET=
TREASURY_ADDRESS=0x87AA66FB877c508420D77A3f7D1D5020b4d1A8f9
BASE_RPC_URL=
HINTS_PRICE_WEI=
ETH_USD_FEED_ADDRESS=
NEXT_PUBLIC_APP_URL=https://your-domain.com
MINIAPP_ASSOC_HEADER=
MINIAPP_ASSOC_PAYLOAD=
MINIAPP_ASSOC_SIGNATURE=
```

Notes:
- `ETH_USD_FEED_ADDRESS` is optional if you prefer `HINTS_PRICE_WEI`.
- `NEXT_PUBLIC_APP_URL` is used for OpenGraph + mini app embed metadata.

## Deploy to Vercel

1. Create a Turso database and obtain `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
2. Add all env vars above to Vercel.
3. Deploy the app.

## Base Mini App Packaging

1. Use Base Build **Account association tool** to generate:
   - `MINIAPP_ASSOC_HEADER`
   - `MINIAPP_ASSOC_PAYLOAD`
   - `MINIAPP_ASSOC_SIGNATURE`
2. Set these in Vercel env vars.
3. Ensure the manifest is accessible at:
   - `https://<your-domain>/.well-known/farcaster.json`
4. Use Base Build **Preview tool** to validate the manifest + embed metadata.

### Manifest & Assets

- Manifest is served dynamically at `/.well-known/farcaster.json`.
- Placeholder assets live in:
  - `public/assets/miniapp/icon.svg`
  - `public/assets/miniapp/splash.svg`
  - `public/assets/miniapp/og.svg`

Replace with real images before launch.
