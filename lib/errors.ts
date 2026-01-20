/**
 * Friendly error message formatter for wallet/transaction errors.
 * Maps viem/wagmi technical errors to user-friendly messages.
 */

// Known error patterns and their friendly messages
const ERROR_PATTERNS: Array<{ pattern: RegExp | string; message: string }> = [
  // User rejection
  { pattern: /user rejected/i, message: "Transaction cancelled" },
  { pattern: /user denied/i, message: "Transaction cancelled" },
  { pattern: /rejected the request/i, message: "Transaction cancelled" },
  { pattern: /cancelled/i, message: "Transaction cancelled" },

  // Chain errors
  { pattern: /wrong chain/i, message: "Please switch to Base" },
  { pattern: /chain mismatch/i, message: "Please switch to Base" },
  { pattern: /switch.*chain/i, message: "Please switch to Base" },

  // Funds errors
  { pattern: /insufficient funds/i, message: "Not enough ETH for gas" },
  { pattern: /exceeds.*balance/i, message: "Not enough ETH for gas" },
  { pattern: /gas/i, message: "Not enough ETH for gas" },

  // Sender errors
  { pattern: /wrong sender/i, message: "Payment sent from different address. Please retry" },
  { pattern: /address mismatch/i, message: "Address mismatch. Please retry" },

  // Network errors
  { pattern: /network/i, message: "Network error. Please try again" },
  { pattern: /timeout/i, message: "Request timed out. Please try again" },
  { pattern: /failed to fetch/i, message: "Network error. Please try again" },

  // Transaction errors
  { pattern: /transaction failed/i, message: "Transaction failed" },
  { pattern: /reverted/i, message: "Transaction failed" },
];

/**
 * Formats a wallet/transaction error into a user-friendly message.
 * Strips out technical details, request args, etc.
 */
export function formatWalletError(error: unknown): string {
  // Extract the message string
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    // Handle viem/wagmi error objects that may have nested structure
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.shortMessage === "string") {
      message = errObj.shortMessage;
    } else if (typeof errObj.message === "string") {
      message = errObj.message;
    } else if (typeof errObj.cause === "object" && errObj.cause) {
      const cause = errObj.cause as Record<string, unknown>;
      if (typeof cause.message === "string") {
        message = cause.message;
      }
    }
  }

  if (!message) {
    return "Something went wrong. Try again";
  }

  // Truncate very long messages before pattern matching
  const truncated = message.length > 500 ? message.slice(0, 500) : message;

  // Check against known patterns
  for (const { pattern, message: friendly } of ERROR_PATTERNS) {
    if (typeof pattern === "string") {
      if (truncated.toLowerCase().includes(pattern.toLowerCase())) {
        return friendly;
      }
    } else if (pattern.test(truncated)) {
      return friendly;
    }
  }

  // Check for "Request Arguments" dump (viem error format)
  if (truncated.includes("Request Arguments") || truncated.includes("request args")) {
    return "Transaction failed. Please try again";
  }

  // If message is very technical (contains code-like chars), return generic
  if (truncated.includes("0x") && truncated.length > 100) {
    return "Something went wrong. Try again";
  }

  // If the message is short and readable, use it
  if (message.length < 80 && !/[{}\[\]()]/.test(message)) {
    return message;
  }

  return "Something went wrong. Try again";
}

/**
 * Checks if an error represents a user cancellation.
 */
export function isUserCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /user rejected/i.test(message) ||
    /user denied/i.test(message) ||
    /cancelled/i.test(message) ||
    /rejected the request/i.test(message)
  );
}
