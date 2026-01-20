import crypto from "crypto";
import { createPublicClient, http, parseAbi, decodeEventLog, type Log } from "viem";
import { base } from "viem/chains";
import { findInternalEthToAddress } from "./basescan";
import BaseCrashHintsAbi from "./contracts/BaseCrashHints.abi.json";

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

// Hints contract address
export function getHintsContractAddress(): string | null {
  return process.env.HINTS_CONTRACT_ADDRESS || null;
}

export function runIdToBytes32(runId: string): string {
  if (runId.startsWith("0x") && runId.length === 66) return runId.toLowerCase();
  const hex = Buffer.from(runId).toString("hex");
  return ("0x" + hex.padEnd(64, "0")).toLowerCase();
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
  runIdBytes32?: string;
  address: string;
  requiredWei: string;
  treasuryAddress: string;
  contractAddress?: string | null;
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
  | { status: "valid"; actualFrom: string; actualTo: string; usedInternalTransfer?: boolean; usedEvent?: boolean; buyer?: string }
  | { status: "pending"; confirmations: number; required: number }
  | { status: "invalid"; error: string; reason?: string; expected?: string; actual?: string; hint?: string };

/**
 * Parsed HintsPurchased event
 */
export interface HintsPurchasedEvent {
  buyer: string;
  runId: string; // bytes32 as hex
  amountWei: bigint;
  hints: bigint;
}

/**
 * Parse HintsPurchased events from transaction receipt logs
 */
export function parseHintsPurchasedEvents(logs: Log[]): HintsPurchasedEvent[] {
  const events: HintsPurchasedEvent[] = [];
  const contractAddress = getHintsContractAddress()?.toLowerCase();

  for (const log of logs) {
    // Only parse logs from our contract
    if (contractAddress && log.address.toLowerCase() !== contractAddress) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: BaseCrashHintsAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "HintsPurchased" && decoded.args) {
        const args = decoded.args as unknown as {
          buyer: string;
          runId: string;
          amountWei: bigint;
          hints: bigint;
        };
        events.push({
          buyer: args.buyer.toLowerCase(),
          runId: args.runId,
          amountWei: args.amountWei,
          hints: args.hints,
        });
      }
    } catch {
      // Not a matching event, skip
    }
  }

  return events;
}

/**
 * Verify hint purchase via contract event (preferred method).
 * Returns the buyer from the event, which is authoritative.
 */
export async function verifyContractPurchase(params: {
  txHash: string;
  expectedRunIdBytes32: string;
  minValue: bigint;
}): Promise<TxVerifyResult> {
  const { txHash, expectedRunIdBytes32, minValue } = params;
  const debugPay = process.env.DEBUG_PAY === "1";
  const contractAddress = getHintsContractAddress();

  if (!contractAddress) {
    return {
      status: "invalid",
      error: "Hints contract not configured",
      reason: "no_contract",
    };
  }

  try {
    const client = getBaseClient();

    // Get transaction receipt
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
      return { status: "invalid", error: "Transaction failed", reason: "tx_failed" };
    }

    // Parse HintsPurchased events from logs
    const events = parseHintsPurchasedEvents(receipt.logs as Log[]);

    if (debugPay) {
      console.log("[DEBUG_PAY] Contract verification:", {
        txHash: txHash.slice(0, 12) + "...",
        logsCount: receipt.logs.length,
        eventsFound: events.length,
        expectedRunId: expectedRunIdBytes32.slice(0, 12) + "...",
      });
    }

    if (events.length === 0) {
      return {
        status: "invalid",
        error: "No HintsPurchased event found",
        reason: "event_not_found",
        expected: contractAddress,
      };
    }

    const expectedRunIdLower = expectedRunIdBytes32.toLowerCase();
    const matchingRunEvents = events.filter(
      (e) => e.runId.toLowerCase() === expectedRunIdLower
    );

    if (matchingRunEvents.length === 0) {
      if (debugPay) {
        console.log("[DEBUG_PAY] RunId mismatch:", {
          expectedRunId: expectedRunIdLower,
          events: events.map((e) => e.runId),
        });
      }
      return {
        status: "invalid",
        error: "Run ID mismatch",
        reason: "runid_mismatch",
        expected: expectedRunIdBytes32,
        actual: events[0]?.runId ?? "unknown",
      };
    }

    const matchingEvent = matchingRunEvents.find((e) => e.amountWei >= minValue);

    if (!matchingEvent) {
      if (debugPay) {
        console.log("[DEBUG_PAY] Insufficient payment:", {
          required: minValue.toString(),
          got: matchingRunEvents.map((e) => e.amountWei.toString()),
        });
      }
      return {
        status: "invalid",
        error: "Insufficient payment",
        reason: "insufficient_payment",
        expected: minValue.toString(),
        actual: matchingRunEvents[0]?.amountWei.toString() ?? "0",
      };
    }

    // Check confirmations
    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);
    if (confirmations < REQUIRED_CONFIRMATIONS) {
      return { status: "pending", confirmations, required: REQUIRED_CONFIRMATIONS };
    }

    return {
      status: "valid",
      actualFrom: matchingEvent.buyer,
      actualTo: contractAddress.toLowerCase(),
      usedEvent: true,
      buyer: matchingEvent.buyer,
    };
  } catch (error) {
    console.error("[Hints] Contract verify error:", error);
    return { status: "invalid", error: "Verification failed", reason: "exception" };
  }
}

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
  const debugPay = process.env.DEBUG_PAY === "1";

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
      return { status: "invalid", error: "Transaction failed", reason: "tx_failed" };
    }

    // Get transaction details for value
    const tx = await client.getTransaction({
      hash: txHash as `0x${string}`,
    });

    if (!tx) {
      return { status: "invalid", error: "Transaction not found", reason: "tx_not_found" };
    }

    // Verify chain (some transaction variants may not include chainId)
    const txChainId =
      "chainId" in tx ? Number(tx.chainId ?? 0) : 8453;
    if (txChainId !== 8453) {
      return { status: "invalid", error: "Wrong chain", reason: "wrong_chain" };
    }

    // Get actual sender and recipient from tx (authoritative)
    const actualFrom = tx.from.toLowerCase();
    // Prefer tx.to, fallback to receipt.to if available
    const actualTo = (tx.to ?? receipt.to ?? "").toLowerCase();
    const expectedToLower = expectedTo.toLowerCase();

    // Debug logging
    if (debugPay) {
      console.log("[DEBUG_PAY] Verification:", {
        txHash: txHash.slice(0, 12) + "...",
        txTo: tx.to?.slice(0, 12) + "...",
        receiptTo: receipt.to ? receipt.to.slice(0, 12) + "..." : "null",
        actualTo: actualTo.slice(0, 12) + "...",
        expectedTo: expectedToLower.slice(0, 12) + "...",
        txValue: tx.value.toString(),
        minValue: minValue.toString(),
        directMatch: actualTo === expectedToLower,
      });
    }

    // Check if direct transfer to treasury
    const isDirectTransfer = actualTo === expectedToLower;
    let usedInternalTransfer = false;
    let verifiedValue = tx.value;

    if (!isDirectTransfer) {
      // Not a direct transfer - try AA/smart wallet fallback via internal transactions
      if (debugPay) {
        console.log("[DEBUG_PAY] Direct transfer mismatch, checking internal transactions...");
      }

      const internalResult = await findInternalEthToAddress(txHash, expectedTo);

      if (internalResult === null) {
        // BaseScan API key not configured - can't verify internal transfers
        return {
          status: "invalid",
          error: "Wrong recipient (smart wallet)",
          reason: "aa_internal_transfer_unverified",
          expected: expectedTo,
          actual: actualTo || "unknown",
          hint: "Set BASESCAN_API_KEY to verify smart wallet payments, or use an EOA wallet",
        };
      }

      if (!internalResult.found || internalResult.totalWei < minValue) {
        // No sufficient internal transfer found
        if (debugPay) {
          console.log("[DEBUG_PAY] No sufficient internal transfer found:", {
            found: internalResult.found,
            totalWei: internalResult.totalWei.toString(),
            minValue: minValue.toString(),
          });
        }
        return {
          status: "invalid",
          error: "Wrong recipient",
          reason: "wrong_recipient",
          expected: expectedTo,
          actual: actualTo || "unknown",
        };
      }

      // Found sufficient internal transfer to treasury
      usedInternalTransfer = true;
      verifiedValue = internalResult.totalWei;

      if (debugPay) {
        console.log("[DEBUG_PAY] Verified via internal transfer:", {
          transfers: internalResult.transfers,
          totalWei: internalResult.totalWei.toString(),
        });
      }
    }

    // Verify value (for direct transfers)
    if (!usedInternalTransfer && verifiedValue < minValue) {
      return {
        status: "invalid",
        error: "Insufficient payment",
        reason: "insufficient_value",
        expected: minValue.toString(),
        actual: verifiedValue.toString(),
      };
    }

    // Check confirmations
    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);
    if (confirmations < REQUIRED_CONFIRMATIONS) {
      return { status: "pending", confirmations, required: REQUIRED_CONFIRMATIONS };
    }

    return { status: "valid", actualFrom, actualTo: expectedToLower, usedInternalTransfer };
  } catch (error) {
    console.error("[Hints] Verify tx error:", error);
    return { status: "invalid", error: "Verification failed", reason: "exception" };
  }
}
