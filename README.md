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
HINTS_CONTRACT_ADDRESS=0x... (see "Deploy Hints Contract" below)
BASESCAN_API_KEY= (optional, for legacy AA wallet fallback)
NEXT_PUBLIC_APP_URL=https://your-domain.com
MINIAPP_ASSOC_HEADER=
MINIAPP_ASSOC_PAYLOAD=
MINIAPP_ASSOC_SIGNATURE=
```

Notes:
- `ETH_USD_FEED_ADDRESS` is optional if you prefer `HINTS_PRICE_WEI`.
- `NEXT_PUBLIC_APP_URL` is used for OpenGraph + mini app embed metadata.

## Deploy Hints Contract (Required for Smart Wallet Support)

The hints contract enables purchases from smart wallets (Base App account abstraction) by emitting on-chain events that the server can verify.

### Prerequisites

```bash
cd contracts
npm install
```

### Deploy to Base Mainnet

```bash
# Set environment variables
export DEPLOYER_PRIVATE_KEY=0x... # Private key with ETH on Base
export TREASURY_ADDRESS=0x87AA66FB877c508420D77A3f7D1D5020b4d1A8f9
export HINTS_PRICE_WEI=333333333333333 # ~$1 at $3000 ETH
export BASESCAN_API_KEY=... # Optional, for contract verification

# Deploy
npm run deploy
```

The script will output the deployed contract address. Add it to Vercel:

```
HINTS_CONTRACT_ADDRESS=0x...
```

### Deploy to Base Sepolia (Testnet)

```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
npm run deploy:testnet
```

### Contract Functions

- `buyHints(bytes32 runId)` - Purchase hints (payable)
- `setTreasury(address)` - Update treasury (owner only)
- `setPrice(uint256)` - Update price in wei (owner only)

### How It Works

1. Frontend calls `buyHints(runIdBytes32)` with ETH payment
2. Contract emits `HintsPurchased(buyer, runId, amount, hints)` event
3. Contract forwards ETH to treasury
4. Backend parses event logs to verify purchase
5. Works with any wallet type (EOA, smart wallet, AA)

## Deploy to Vercel

1. Create a Turso database and obtain `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
2. Deploy the hints contract (see above) and get `HINTS_CONTRACT_ADDRESS`.
3. Add all env vars above to Vercel.
4. Deploy the app.

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
