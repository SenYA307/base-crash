/**
 * Robust signature normalization for Ethereum signatures.
 * Handles various formats returned by different wallets:
 * - 0x-prefixed hex strings
 * - Hex without 0x prefix
 * - Base64 and base64url encoded (with/without padding)
 * - Uint8Array / ArrayBuffer
 * - Objects with signature/sig/result/data fields
 *
 * Works in both browser and Node.js environments.
 */

export type NormalizeResult =
  | {
      ok: true;
      signature: `0x${string}`;
      signatureAlt?: `0x${string}`; // Alternative signature with different v value
      kind: string;
      rawLength: number;
      normalizedLength: number;
      compactApplied: boolean;
    }
  | { ok: false; error: string; kind: string; rawLength?: number };

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Convert bytes to 0x-prefixed hex string
 */
function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}

/**
 * Convert hex string (no 0x) to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Expand EIP-2098 compact signature (64 bytes) to full 65-byte signature
 * Returns both possible signatures (v=27 and v=28) since recovery bit might be ambiguous
 */
function expandCompactSignature(bytes: Uint8Array): {
  signature: `0x${string}`;
  signatureAlt: `0x${string}`;
  compactApplied: boolean;
  yParity: number;
} {
  const r = bytes.slice(0, 32);
  const vs = bytes.slice(32, 64);

  // EIP-2098: yParity is encoded in the highest bit of vs[0]
  const yParity = (vs[0] & 0x80) ? 1 : 0;
  const s = new Uint8Array(vs);
  s[0] &= 0x7f; // Clear the highest bit to get s
  const v = 27 + yParity;
  const vAlt = 27 + (1 - yParity); // Alternative v value

  const full = new Uint8Array(65);
  full.set(r, 0);
  full.set(s, 32);
  full[64] = v;

  const fullAlt = new Uint8Array(65);
  fullAlt.set(r, 0);
  fullAlt.set(s, 32);
  fullAlt[64] = vAlt;

  return {
    signature: bytesToHex(full),
    signatureAlt: bytesToHex(fullAlt),
    compactApplied: true,
    yParity,
  };
}

/**
 * For 64-byte signatures without EIP-2098 encoding, try both v values
 */
function expand64ByteSignature(bytes: Uint8Array): {
  signature: `0x${string}`;
  signatureAlt: `0x${string}`;
} {
  const full27 = new Uint8Array(65);
  full27.set(bytes, 0);
  full27[64] = 27;

  const full28 = new Uint8Array(65);
  full28.set(bytes, 0);
  full28[64] = 28;

  return {
    signature: bytesToHex(full27),
    signatureAlt: bytesToHex(full28),
  };
}

/**
 * Decode base64 or base64url to Uint8Array
 */
function decodeBase64(input: string): Uint8Array | null {
  try {
    // Convert base64url to base64
    let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }

    // Use Buffer in Node.js, atob in browser
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    } else if (typeof atob !== "undefined") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract signature from an object by checking common fields
 */
function extractFromObject(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;
  // Check fields in priority order
  for (const field of ["signature", "sig", "result", "data"]) {
    if (field in record && record[field] != null) {
      return record[field];
    }
  }
  return null;
}

/**
 * Normalize any signature input to 0x-prefixed hex string (65 bytes = 130 hex chars + 0x)
 */
export function normalizeSignature(input: unknown): NormalizeResult {
  // Handle null/undefined
  if (input == null) {
    return { ok: false, error: "Signature is null or undefined", kind: "null" };
  }

  // Handle Uint8Array
  if (input instanceof Uint8Array) {
    if (input.length === 65) {
      const signature = bytesToHex(input);
      return {
        ok: true,
        signature,
        kind: "Uint8Array",
        rawLength: input.length,
        normalizedLength: signature.length,
        compactApplied: false,
      };
    }
    if (input.length === 64) {
      // Try EIP-2098 compact signature expansion
      const { signature, signatureAlt, compactApplied } = expandCompactSignature(input);
      return {
        ok: true,
        signature,
        signatureAlt,
        kind: "Uint8Array-compact",
        rawLength: input.length,
        normalizedLength: signature.length,
        compactApplied,
      };
    }
    return {
      ok: false,
      error: `Unsupported signature length: ${input.length} bytes`,
      kind: "Uint8Array",
      rawLength: input.length,
    };
  }

  // Handle ArrayBuffer
  if (input instanceof ArrayBuffer) {
    return normalizeSignature(new Uint8Array(input));
  }

  // Handle objects - extract signature field
  if (typeof input === "object") {
    const extracted = extractFromObject(input);
    if (extracted != null) {
      const result = normalizeSignature(extracted);
      return { ...result, kind: `object->${result.kind}` };
    }
    return { ok: false, error: "Object has no signature field", kind: "object" };
  }

  // Handle strings
  if (typeof input === "string") {
    // Clean up: trim whitespace and remove surrounding quotes
    let sig = input.trim();
    if ((sig.startsWith('"') && sig.endsWith('"')) || (sig.startsWith("'") && sig.endsWith("'"))) {
      sig = sig.slice(1, -1);
    }

    // Empty string
    if (!sig) {
      return { ok: false, error: "Signature is empty", kind: "string-empty", rawLength: 0 };
    }

    // Already 0x-prefixed hex
    if (sig.startsWith("0x")) {
      const hexPart = sig.slice(2);
      if (HEX_REGEX.test(hexPart)) {
        if (hexPart.length === 130) {
          // Perfect: 65 bytes
          return {
            ok: true,
            signature: sig as `0x${string}`,
            kind: "hex-0x",
            rawLength: sig.length,
            normalizedLength: sig.length,
            compactApplied: false,
          };
        }
        if (hexPart.length === 128) {
          const bytes = hexToBytes(hexPart);
          const { signature, signatureAlt, compactApplied } = expandCompactSignature(bytes);
          return {
            ok: true,
            signature,
            signatureAlt,
            kind: "hex-0x-compact",
            rawLength: sig.length,
            normalizedLength: signature.length,
            compactApplied,
          };
        }
        return {
          ok: false,
          error: `Unsupported signature length: ${hexPart.length / 2} bytes`,
          kind: "hex-0x",
          rawLength: sig.length,
        };
      }
    }

    // Hex without 0x prefix
    if (HEX_REGEX.test(sig)) {
      if (sig.length === 130) {
        const signature = `0x${sig}` as `0x${string}`;
        return {
          ok: true,
          signature,
          kind: "hex-raw",
          rawLength: sig.length,
          normalizedLength: signature.length,
          compactApplied: false,
        };
      }
      if (sig.length === 128) {
        const bytes = hexToBytes(sig);
        const { signature, signatureAlt, compactApplied } = expandCompactSignature(bytes);
        return {
          ok: true,
          signature,
          signatureAlt,
          kind: "hex-raw-compact",
          rawLength: sig.length,
          normalizedLength: signature.length,
          compactApplied,
        };
      }
      // Could be short hex - might be base64 that happens to look like hex
      // Try as hex if length is close to expected
      if (sig.length >= 126 && sig.length <= 132) {
        return {
          ok: false,
          error: `Unsupported signature length: ${sig.length / 2} bytes`,
          kind: "hex-raw",
          rawLength: sig.length,
        };
      }
      // Fall through to try base64
    }

    // Try base64url first (contains _ or -)
    if (sig.includes("-") || sig.includes("_") || BASE64URL_REGEX.test(sig)) {
      const bytes = decodeBase64(sig);
      if (bytes) {
        if (bytes.length === 65) {
          const signature = bytesToHex(bytes);
          return {
            ok: true,
            signature,
            kind: "base64url",
            rawLength: sig.length,
            normalizedLength: signature.length,
            compactApplied: false,
          };
        }
        if (bytes.length === 64) {
          const { signature, signatureAlt, compactApplied } = expandCompactSignature(bytes);
          return {
            ok: true,
            signature,
            signatureAlt,
            kind: "base64url-compact",
            rawLength: sig.length,
            normalizedLength: signature.length,
            compactApplied,
          };
        }
        // If decoded to something unexpected, might not be base64 at all
        if (bytes.length > 60 && bytes.length < 70) {
          return {
            ok: false,
            error: `Unsupported signature length: ${bytes.length} bytes`,
            kind: "base64url",
            rawLength: sig.length,
          };
        }
      }
    }

    // Try standard base64
    if (BASE64_REGEX.test(sig)) {
      const bytes = decodeBase64(sig);
      if (bytes) {
        if (bytes.length === 65) {
          const signature = bytesToHex(bytes);
          return {
            ok: true,
            signature,
            kind: "base64",
            rawLength: sig.length,
            normalizedLength: signature.length,
            compactApplied: false,
          };
        }
        if (bytes.length === 64) {
          const { signature, signatureAlt, compactApplied } = expandCompactSignature(bytes);
          return {
            ok: true,
            signature,
            signatureAlt,
            kind: "base64-compact",
            rawLength: sig.length,
            normalizedLength: signature.length,
            compactApplied,
          };
        }
        if (bytes.length > 60 && bytes.length < 70) {
          return {
            ok: false,
            error: `Unsupported signature length: ${bytes.length} bytes`,
            kind: "base64",
            rawLength: sig.length,
          };
        }
      }
    }

    // Last resort: if it looks like hex, try to use it
    if (HEX_REGEX.test(sig) && sig.length >= 100) {
      return {
        ok: false,
        error: `Unsupported signature length: ${sig.length / 2} bytes`,
        kind: "hex-unknown",
        rawLength: sig.length,
      };
    }

    return { ok: false, error: "Unrecognized signature format", kind: "string-unknown", rawLength: sig.length };
  }

  return { ok: false, error: `Unsupported input type: ${typeof input}`, kind: typeof input };
}

/**
 * Debug logging helper - logs signature info without exposing full signature
 */
export function logSignatureDebug(label: string, input: unknown): void {
  // Only log when DEBUG_SIGN=1
  let debugEnabled = false;
  if (typeof process !== "undefined" && process.env?.DEBUG_SIGN === "1") {
    debugEnabled = true;
  } else if (typeof window !== "undefined") {
    // Check for window.DEBUG_SIGN in a type-safe way
    const win = window as unknown as Record<string, unknown>;
    if (win.DEBUG_SIGN === true) {
      debugEnabled = true;
    }
  }

  if (!debugEnabled) return;

  const info: Record<string, unknown> = {
    type: typeof input,
  };

  if (input == null) {
    info.value = String(input);
  } else if (input instanceof Uint8Array) {
    info.length = input.length;
    info.preview = `[${input.slice(0, 4).join(",")}...]`;
  } else if (input instanceof ArrayBuffer) {
    info.length = input.byteLength;
  } else if (typeof input === "string") {
    info.length = input.length;
    info.preview = input.slice(0, 12) + (input.length > 12 ? "..." : "");
    info.startsWithHex = input.startsWith("0x");
  } else if (typeof input === "object") {
    const data = input as Record<string, unknown>;
    if (
      "kind" in data ||
      "rawLength" in data ||
      "normalizedLength" in data ||
      "compactApplied" in data
    ) {
      info.kind = data.kind;
      info.rawLength = data.rawLength;
      info.normalizedLength = data.normalizedLength;
      info.compactApplied = data.compactApplied;
    } else {
      info.keys = Object.keys(input as object).slice(0, 5);
    }
  }

  console.log(`[signature] ${label}:`, info);
}
