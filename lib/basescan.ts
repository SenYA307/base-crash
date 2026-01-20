/**
 * BaseScan API helper for fetching internal transactions.
 * Used to verify smart wallet / account abstraction payments.
 */

const BASESCAN_API_URL = "https://api.basescan.org/api";

export interface InternalTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string; // wei as string
  contractAddress: string;
  input: string;
  type: string;
  gas: string;
  gasUsed: string;
  traceId: string;
  isError: string; // "0" = success, "1" = error
  errCode: string;
}

export interface BaseScanResponse {
  status: string; // "1" = success, "0" = error
  message: string;
  result: InternalTx[] | string; // string if error
}

/**
 * Fetch internal transactions for a specific tx hash from BaseScan.
 * Returns null if API key is not configured.
 */
export async function fetchInternalTransactions(
  txHash: string
): Promise<InternalTx[] | null> {
  const apiKey = process.env.BASESCAN_API_KEY;
  
  if (!apiKey) {
    console.log("[basescan] BASESCAN_API_KEY not configured");
    return null;
  }

  try {
    const url = `${BASESCAN_API_URL}?module=account&action=txlistinternal&txhash=${txHash}&apikey=${apiKey}`;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.error("[basescan] API request failed:", response.status);
      return null;
    }

    const data: BaseScanResponse = await response.json();

    if (data.status !== "1") {
      // status "0" can mean no internal txs found (not an error)
      if (data.message === "No transactions found") {
        return [];
      }
      console.log("[basescan] API returned status 0:", data.message);
      return [];
    }

    if (!Array.isArray(data.result)) {
      console.log("[basescan] Unexpected result format");
      return [];
    }

    return data.result;
  } catch (error) {
    console.error("[basescan] Error fetching internal transactions:", error);
    return null;
  }
}

/**
 * Find the total ETH (in wei) sent to a specific address via internal transactions.
 * Returns the sum of successful internal transfers to the target address.
 */
export async function findInternalEthToAddress(
  txHash: string,
  targetAddress: string
): Promise<{ found: boolean; totalWei: bigint; transfers: number } | null> {
  const internalTxs = await fetchInternalTransactions(txHash);
  
  if (internalTxs === null) {
    // API key not configured or API error
    return null;
  }

  const targetLower = targetAddress.toLowerCase();
  let totalWei = 0n;
  let transfers = 0;

  for (const itx of internalTxs) {
    // Only count successful transfers to target
    if (itx.to.toLowerCase() === targetLower && itx.isError === "0") {
      try {
        totalWei += BigInt(itx.value);
        transfers++;
      } catch {
        // Invalid value, skip
      }
    }
  }

  const debugPay = process.env.DEBUG_PAY === "1";
  if (debugPay) {
    console.log("[basescan] Internal transfers to treasury:", {
      txHash: txHash.slice(0, 12) + "...",
      target: targetLower.slice(0, 12) + "...",
      totalInternalTxs: internalTxs.length,
      matchingTransfers: transfers,
      totalWei: totalWei.toString(),
    });
  }

  return {
    found: transfers > 0,
    totalWei,
    transfers,
  };
}
