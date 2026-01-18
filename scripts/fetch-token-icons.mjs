#!/usr/bin/env node
/**
 * Fetch token icons from Trust Wallet Assets repo (with fallbacks)
 * Usage: node scripts/fetch-token-icons.mjs
 *
 * Fallback order:
 * 1. TrustWallet Base chain
 * 2. TrustWallet Ethereum chain (ERC20)
 * 3. CoinGecko API (if COINGECKO_API_KEY is set)
 */

import { getAddress } from "viem";
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "public", "assets", "tokens");

const DEBUG = process.env.DEBUG === "1";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";

// Token addresses on Base
const TOKENS = {
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  aero: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
  owb: "0xEF5997c2cf2f6c138196f8A6203afc335206b3c1",
  cbbtc: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
  zora: "0x1111111111166b7fe7bd91427724b487980afc69",
  degen: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
  brett: "0x532f27101965dd16442e59d40670faf5ebb142e4",
};

// ETH uses ethereum chain info logo (not an ERC20 token)
const ETH_LOGO_URL =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";

function getTrustWalletBaseUrl(address) {
  const checksumAddress = getAddress(address);
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksumAddress}/logo.png`;
}

function getTrustWalletEthereumUrl(address) {
  const checksumAddress = getAddress(address);
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${checksumAddress}/logo.png`;
}

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isValidPng(buffer) {
  if (!buffer || buffer.length < 8) return false;

  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_MAGIC[i]) {
      return false;
    }
  }
  return true;
}

function bufferToHex(buffer, length = 32) {
  const bytes = [];
  for (let i = 0; i < Math.min(buffer.length, length); i++) {
    bytes.push(buffer[i].toString(16).padStart(2, "0"));
  }
  return bytes.join(" ");
}

async function fetchImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BaseCrash/1.0)",
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, buffer: null };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { ok: true, status: response.status, buffer };
  } catch (error) {
    return { ok: false, status: 0, buffer: null, error: error.message };
  }
}

async function fetchFromCoinGecko(name, address) {
  if (!COINGECKO_API_KEY) {
    return null;
  }

  try {
    const url = `https://pro-api.coingecko.com/api/v3/onchain/networks/base/tokens/${address.toLowerCase()}/info`;

    if (DEBUG) console.log(`    [CoinGecko] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "x-cg-pro-api-key": COINGECKO_API_KEY,
        "User-Agent": "Mozilla/5.0 (compatible; BaseCrash/1.0)",
      },
    });

    if (!response.ok) {
      if (DEBUG) console.log(`    [CoinGecko] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const imageUrl =
      data?.data?.attributes?.image_url || data?.data?.image?.large;

    if (!imageUrl) {
      if (DEBUG) console.log(`    [CoinGecko] No image URL in response`);
      return null;
    }

    if (DEBUG) console.log(`    [CoinGecko] Found image: ${imageUrl}`);

    // Download the image
    const imageResult = await fetchImage(imageUrl);
    if (imageResult.ok && imageResult.buffer) {
      return imageResult.buffer;
    }

    return null;
  } catch (error) {
    if (DEBUG) console.log(`    [CoinGecko] Error: ${error.message}`);
    return null;
  }
}

async function downloadIcon(name, address) {
  const outputPath = join(OUTPUT_DIR, `${name}.png`);
  const urls = [];

  // Build URL list based on token
  if (name === "eth") {
    urls.push({ source: "TrustWallet Ethereum", url: ETH_LOGO_URL });
  } else {
    urls.push({
      source: "TrustWallet Base",
      url: getTrustWalletBaseUrl(address),
    });
    urls.push({
      source: "TrustWallet Ethereum",
      url: getTrustWalletEthereumUrl(address),
    });
  }

  // Try each URL in order
  for (const { source, url } of urls) {
    console.log(`  [${name}] Trying ${source}...`);
    if (DEBUG) console.log(`    URL: ${url}`);

    const result = await fetchImage(url);

    if (!result.ok) {
      console.log(`    ❌ HTTP ${result.status || "error"}`);
      continue;
    }

    if (!isValidPng(result.buffer)) {
      console.log(`    ❌ Not a valid PNG`);
      if (DEBUG) {
        console.log(`    First 32 bytes: ${bufferToHex(result.buffer)}`);
      }
      continue;
    }

    // Valid PNG - save it
    writeFileSync(outputPath, result.buffer);
    console.log(`    ✅ Saved (${result.buffer.length} bytes)`);
    return true;
  }

  // Try CoinGecko fallback for non-ETH tokens
  if (name !== "eth" && address) {
    if (COINGECKO_API_KEY) {
      console.log(`  [${name}] Trying CoinGecko API...`);
      const buffer = await fetchFromCoinGecko(name, address);

      if (buffer && isValidPng(buffer)) {
        writeFileSync(outputPath, buffer);
        console.log(`    ✅ Saved from CoinGecko (${buffer.length} bytes)`);
        return true;
      } else if (buffer) {
        console.log(`    ❌ CoinGecko image not a valid PNG`);
      } else {
        console.log(`    ❌ CoinGecko: not found`);
      }
    } else {
      console.log(
        `  [${name}] ⚠️  Not found on TrustWallet. Set COINGECKO_API_KEY to enable CoinGecko fallback.`
      );
    }
  }

  return false;
}

async function main() {
  console.log("🎨 Fetching token icons...\n");
  console.log(
    `   TrustWallet fallback: Base → Ethereum${COINGECKO_API_KEY ? " → CoinGecko" : ""}\n`
  );

  // Create output directory if missing
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${OUTPUT_DIR}\n`);
  }

  const results = [];

  // Download Base tokens
  for (const [name, address] of Object.entries(TOKENS)) {
    const success = await downloadIcon(name, address);
    results.push({ name, success });
  }

  // Download ETH
  const ethSuccess = await downloadIcon("eth", null);
  results.push({ name: "eth", success: ethSuccess });

  // Print summary table
  console.log("\n" + "=".repeat(50));
  console.log("📋 ICON STATUS:\n");

  const allTokens = [...Object.keys(TOKENS), "eth"];
  let successCount = 0;
  let failCount = 0;

  for (const name of allTokens) {
    const filePath = join(OUTPUT_DIR, `${name}.png`);
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      console.log(`  ✅ ${name.padEnd(8)} ${stats.size.toString().padStart(6)} bytes`);
      successCount++;
    } else {
      console.log(`  ❌ ${name.padEnd(8)} MISSING (will use fallback letter)`);
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`✅ Downloaded: ${successCount} / ${allTokens.length}`);

  if (failCount > 0) {
    console.log(`❌ Missing: ${failCount}`);
    console.log(
      "\n⚠️  Missing icons will display as colored tiles with letters."
    );
    if (!COINGECKO_API_KEY) {
      console.log(
        "   Tip: Set COINGECKO_API_KEY env var to enable CoinGecko fallback."
      );
    }
  } else {
    console.log("\n🎉 All icons downloaded successfully!");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
