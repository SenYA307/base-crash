import crypto from "crypto";
import { createPublicClient, http, decodeEventLog, type Log } from "viem";
import { base } from "viem/chains";
import ERC20Abi from "./contracts/ERC20.abi.json";

export const HINTS_PACK_SIZE = 3;
export const FREE_HINTS_PER_RUN = 3;
export const INTENT_EXPIRY_SECONDS = 300; // 5 minutes

// USDC on Base mainnet
export const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_DECIMALS = 6;

// Default price: 1 USDC = 1_000000 (6 decimals)
export function getHintsPriceUsdc(): bigint {
  const priceStr = process.env.HINTS_PRICE_USDC || "1000000";
  return BigInt(priceStr);
}

// Treasury address
export function getTreasuryAddress(): string {
  return (
    process.env.TREASURY_ADDRESS ||
    "0x87AA66FB877c508420D77A3f7D1D5020b4d1A8f9"
  );
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
 * Get required USDC amount for hint pack purchase.
 * Returns amount in USDC smallest units (6 decimals).
 */
export function getRequiredUsdc(): bigint {
  return getHintsPriceUsdc();
}

export type IntentPayload = {
  runId: string;
  runIdBytes32?: string;
  address: string;
  // USDC payment (6 decimals)
  requiredUsdc: string;
  tokenAddress: string; // USDC contract address
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
  | { status: "valid"; buyer: string; amount: bigint }
  | { status: "pending"; confirmations: number; required: number }
  | { status: "invalid"; error: string; reason?: string; expected?: string; actual?: string };

/**
 * Parsed ERC-20 Transfer event
 */
export interface TransferEvent {
  from: string;
  to: string;
  value: bigint;
}

/**
 * Parse ERC-20 Transfer events from transaction receipt logs
 */
export function parseTransferEvents(logs: Log[], tokenAddress: string): TransferEvent[] {
  const events: TransferEvent[] = [];
  const tokenLower = tokenAddress.toLowerCase();

  for (const log of logs) {
    // Only parse logs from the specified token contract
    if (log.address.toLowerCase() !== tokenLower) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ERC20Abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "Transfer" && decoded.args) {
        const args = decoded.args as unknown as {
          from: string;
          to: string;
          value: bigint;
        };
        events.push({
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
          value: args.value,
        });
      }
    } catch {
      // Not a matching event, skip
    }
  }

  return events;
}

/**
 * Verify USDC hint purchase by parsing Transfer logs.
 * This is the primary verification method - works for EOA and AA wallets.
 */
export async function verifyUsdcPurchase(params: {
  txHash: string;
  expectedTreasury: string;
  minAmount: bigint;
}): Promise<TxVerifyResult> {
  const { txHash, expectedTreasury, minAmount } = params;
  const debugPay = process.env.DEBUG_PAY === "1";
  const treasuryLower = expectedTreasury.toLowerCase();

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

    // Parse Transfer events from USDC contract
    const transfers = parseTransferEvents(receipt.logs as Log[], USDC_ADDRESS);

    if (debugPay) {
      console.log("[DEBUG_PAY] USDC verification:", {
        txHash: txHash.slice(0, 12) + "...",
        logsCount: receipt.logs.length,
        transfersFound: transfers.length,
        expectedTreasury: treasuryLower.slice(0, 12) + "...",
        minAmount: minAmount.toString(),
      });
    }

    // Find transfer to treasury with sufficient amount
    const matchingTransfer = transfers.find(
      (t) => t.to === treasuryLower && t.value >= minAmount
    );

    if (!matchingTransfer) {
      if (debugPay) {
        console.log("[DEBUG_PAY] No matching transfer:", {
          transfers: transfers.map((t) => ({
            from: t.from.slice(0, 12),
            to: t.to.slice(0, 12),
            value: t.value.toString(),
          })),
        });
      }

      // Check if there was a transfer to wrong address
      if (transfers.length > 0) {
        const anyTransfer = transfers[0];
        if (anyTransfer.to !== treasuryLower) {
          return {
            status: "invalid",
            error: "USDC sent to wrong address",
            reason: "wrong_recipient",
            expected: expectedTreasury,
            actual: anyTransfer.to,
          };
        }
        if (anyTransfer.value < minAmount) {
          return {
            status: "invalid",
            error: "Insufficient USDC amount",
            reason: "insufficient_payment",
            expected: minAmount.toString(),
            actual: anyTransfer.value.toString(),
          };
        }
      }

      return {
        status: "invalid",
        error: "No USDC transfer to treasury found",
        reason: "transfer_not_found",
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
      buyer: matchingTransfer.from,
      amount: matchingTransfer.value,
    };
  } catch (error) {
    console.error("[Hints] USDC verify error:", error);
    return { status: "invalid", error: "Verification failed", reason: "exception" };
  }
}
