import crypto from "crypto";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

export const HINTS_PACK_SIZE = 3;
export const FREE_HINTS_PER_RUN = 3;
export const INTENT_EXPIRY_SECONDS = 300; // 5 minutes

// Chainlink ETH/USD feed ABI (just latestRoundData)
const PRICE_FEED_ABI = parseAbi([
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

// Treasury address
export function getTreasuryAddress(): string {
  return (
    process.env.TREASURY_ADDRESS ||
    "0x87AA66FB877c508420D77A3f7D1D5020b4d1A8f9"
  );
}

let hasWarnedSecretFallback = false;

function getHintsPaymentSecret(): string {
  const secret = process.env.HINTS_PAYMENT_SECRET;
  if (secret) {
    return secret;
  }

  // In production, we must have the secret
  if (process.env.NODE_ENV === "production") {
    throw new Error("HINTS_PAYMENT_SECRET is not set");
  }

  // Dev fallback: use AUTH_TOKEN_SECRET if available
  const fallback = process.env.AUTH_TOKEN_SECRET;
  if (fallback) {
    if (!hasWarnedSecretFallback) {
      console.warn(
        "[Hints] HINTS_PAYMENT_SECRET not set, using AUTH_TOKEN_SECRET as fallback (dev only)"
      );
      hasWarnedSecretFallback = true;
    }
    return fallback;
  }

  throw new Error("HINTS_PAYMENT_SECRET is not set (and no fallback available)");
}

// Get Base RPC client
function getBaseClient() {
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

/**
 * Calculate required wei for $1 worth of ETH.
 * Adds a 2% buffer to avoid underpayment.
 */
export async function calculateRequiredWei(): Promise<bigint> {
  // Check for fixed price override
  const fixedWei = process.env.HINTS_PRICE_WEI;
  if (fixedWei) {
    return BigInt(fixedWei);
  }

  const feedAddress = process.env.ETH_USD_FEED_ADDRESS;
  if (!feedAddress) {
    // No feed configured, use a default (~$3000 = 0.000333 ETH for $1)
    // This is a fallback; should configure properly in production
    console.warn("[Hints] No ETH_USD_FEED_ADDRESS set, using fallback price");
    return BigInt("333333333333333"); // ~0.000333 ETH
  }

  try {
    const client = getBaseClient();
    const result = await client.readContract({
      address: feedAddress as `0x${string}`,
      abi: PRICE_FEED_ABI,
      functionName: "latestRoundData",
    });

    // answer is ETH/USD price with 8 decimals
    const ethUsdPrice = result[1];
    if (ethUsdPrice <= 0n) {
      throw new Error("Invalid price from feed");
    }

    // $1 in ETH = 1 / ethUsdPrice (adjusted for decimals)
    // ethUsdPrice has 8 decimals, ETH has 18 decimals
    // requiredWei = (1 * 10^18 * 10^8) / ethUsdPrice
    const oneUsdInWei = (BigInt(1e18) * BigInt(1e8)) / ethUsdPrice;

    // Add 2% buffer
    const withBuffer = (oneUsdInWei * 102n) / 100n;

    return withBuffer;
  } catch (error) {
    console.error("[Hints] Price feed error:", error);
    // Fallback
    return BigInt("333333333333333");
  }
}

export type IntentPayload = {
  runId: string;
  address: string;
  requiredWei: string;
  treasuryAddress: string;
  packSize: number;
  iat: number;
  exp: number;
};

export function signIntentToken(payload: IntentPayload): string {
  const secret = getHintsPaymentSecret();
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");
  return `${payloadEncoded}.${signature}`;
}

export function verifyIntentToken(token: string): IntentPayload | null {
  const secret = getHintsPaymentSecret();
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadEncoded, "base64url").toString("utf-8")
    ) as IntentPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const REQUIRED_CONFIRMATIONS = 1;

export type TxVerifyResult =
  | { status: "valid"; actualFrom: string }
  | { status: "pending"; confirmations: number; required: number }
  | { status: "invalid"; error: string };

/**
 * Verify transaction on Base chain.
 * Now uses tx.from as the authoritative sender (for smart wallet support).
 * Does NOT require expectedFrom to match - returns actualFrom for caller to use.
 */
export async function verifyTransaction(params: {
  txHash: string;
  expectedTo: string;
  minValue: bigint;
}): Promise<TxVerifyResult> {
  const { txHash, expectedTo, minValue } = params;

  try {
    const client = getBaseClient();

    // Get transaction receipt (may throw if not found)
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
    } catch {
      return { status: "pending", confirmations: 0, required: REQUIRED_CONFIRMATIONS };
    }

    if (!receipt) {
      return { status: "pending", confirmations: 0, required: REQUIRED_CONFIRMATIONS };
    }

    if (receipt.status !== "success") {
      return { status: "invalid", error: "Transaction failed" };
    }

    // Get transaction details for value
    const tx = await client.getTransaction({
      hash: txHash as `0x${string}`,
    });

    if (!tx) {
      return { status: "invalid", error: "Transaction not found" };
    }

    // Verify chain (some transaction variants may not include chainId)
    const txChainId =
      "chainId" in tx ? Number(tx.chainId ?? 0) : 8453;
    if (txChainId !== 8453) {
      return { status: "invalid", error: "Wrong chain" };
    }

    // Get actual sender from tx (authoritative for smart wallets)
    const actualFrom = tx.from.toLowerCase();

    // Verify to address
    if (!tx.to || tx.to.toLowerCase() !== expectedTo.toLowerCase()) {
      return { status: "invalid", error: "Wrong recipient" };
    }

    // Verify value
    if (tx.value < minValue) {
      return { status: "invalid", error: "Insufficient payment" };
    }

    // Check confirmations
    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);
    if (confirmations < REQUIRED_CONFIRMATIONS) {
      return { status: "pending", confirmations, required: REQUIRED_CONFIRMATIONS };
    }

    return { status: "valid", actualFrom };
  } catch (error) {
    console.error("[Hints] Verify tx error:", error);
    return { status: "invalid", error: "Verification failed" };
  }
}
