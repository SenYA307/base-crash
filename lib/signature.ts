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
      allCandidates?: Array<{ sig: `0x${string}`; strategy: string }>; // All extracted candidates
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
 * Try to extract a valid 65 or 64 byte signature from a longer hex string.
 * Smart wallets (EIP-6492, ERC-4337, Safe) often wrap signatures with extra data.
 * 
 * Common formats for 450-char (224 bytes) signatures:
 * - ABI-encoded: offset pointer (32) + length (32) + signature (65) + padding
 * - EIP-6492: signature + factory address + init data + magic bytes
 */
function tryExtractSignature(hexStr: string): {
  extracted: boolean;
  signatures?: Array<{ sig: `0x${string}`; strategy: string }>;
  strategy?: string;
  extractedLen?: number;
} {
  // Remove 0x prefix for processing
  const hex = hexStr.startsWith("0x") ? hexStr.slice(2) : hexStr;
  
  const candidates: Array<{ sig: `0x${string}`; alt?: `0x${string}`; strategy: string; priority: number }> = [];

  // Helper to normalize v byte
  const normalizeV = (sigHex: string): `0x${string}` | null => {
    if (sigHex.length !== 130) return null;
    const vByte = parseInt(sigHex.slice(-2), 16);
    // Valid v values: 0, 1, 27, 28
    if (vByte === 27 || vByte === 28) {
      return `0x${sigHex}` as `0x${string}`;
    }
    if (vByte === 0 || vByte === 1) {
      return `0x${sigHex.slice(0, -2)}${(27 + vByte).toString(16).padStart(2, "0")}` as `0x${string}`;
    }
    // Also accept v=0x1b (27) or v=0x1c (28) anywhere in reasonable range
    if (vByte >= 27 && vByte <= 35) {
      // EIP-155 chain-specific v values, normalize
      const parity = (vByte - 27) % 2;
      return `0x${sigHex.slice(0, -2)}${(27 + parity).toString(16).padStart(2, "0")}` as `0x${string}`;
    }
    return null;
  };

  // Strategy 1: ABI-encoded signature
  // Format: 32 bytes offset (0x40 = 64) + 32 bytes length (0x41 = 65) + 65 bytes sig
  // At offset 64 (128 hex chars), check if it's 0x41 (65 in hex, padded to 32 bytes)
  if (hex.length >= 128 + 64 + 130) {
    // Skip first 32 bytes (offset pointer), read length at bytes 32-64
    const lengthHex = hex.slice(64, 128);
    const length = parseInt(lengthHex, 16);
    if (length === 65) {
      // Signature starts at byte 64 (128 hex chars)
      const sigHex = hex.slice(128, 128 + 130);
      const normalized = normalizeV(sigHex);
      if (normalized) {
        candidates.push({ sig: normalized, strategy: "abi-encoded-65", priority: 1 });
      }
    }
  }

  // Strategy 2: Skip leading zeros, find first non-zero byte, take 65 bytes from there
  const firstNonZero = hex.search(/[1-9a-fA-F]/);
  if (firstNonZero >= 0 && firstNonZero % 2 === 0) {
    // Align to byte boundary
    const startPos = firstNonZero;
    if (hex.length >= startPos + 130) {
      const sigHex = hex.slice(startPos, startPos + 130);
      const normalized = normalizeV(sigHex);
      if (normalized) {
        candidates.push({ sig: normalized, strategy: "after-leading-zeros", priority: 2 });
      }
    }
  }

  // Strategy 3: Last 130 chars (65 bytes) - signature appended at end
  if (hex.length >= 130) {
    const last130 = hex.slice(-130);
    const normalized = normalizeV(last130);
    if (normalized) {
      candidates.push({ sig: normalized, strategy: "last-130", priority: 3 });
    }
  }

  // Strategy 4: Try common offsets for padded signatures
  // 32 bytes (64 chars), 64 bytes (128 chars), 96 bytes (192 chars)
  for (const offset of [64, 128, 192]) {
    if (hex.length >= offset + 130) {
      const sigHex = hex.slice(offset, offset + 130);
      const normalized = normalizeV(sigHex);
      if (normalized) {
        candidates.push({ sig: normalized, strategy: `offset-${offset / 2}`, priority: 4 });
      }
    }
  }

  // Strategy 5: Scan for any 65-byte sequence that looks like a signature
  // r and s should be < secp256k1 order (starts with byte < 0xff usually)
  for (let i = 0; i <= hex.length - 130; i += 2) {
    const candidate = hex.slice(i, i + 130);
    // Quick sanity check: first byte of r shouldn't be 00 (would be non-canonical)
    // and v should be valid
    const firstByte = parseInt(candidate.slice(0, 2), 16);
    if (firstByte > 0 && firstByte < 0xff) {
      const normalized = normalizeV(candidate);
      if (normalized) {
        // Avoid duplicates
        if (!candidates.some(c => c.sig === normalized)) {
          candidates.push({ sig: normalized, strategy: `scan-pos-${i / 2}`, priority: 5 });
        }
      }
    }
  }

  // Strategy 6: Try EIP-2098 compact (64 bytes) at various offsets
  for (const offset of [0, 64, 128, hex.length - 128]) {
    if (offset >= 0 && hex.length >= offset + 128) {
      const compactHex = hex.slice(offset, offset + 128);
      if (HEX_REGEX.test(compactHex)) {
        const bytes = hexToBytes(compactHex);
        const { signature, signatureAlt } = expandCompactSignature(bytes);
        candidates.push({ sig: signature, alt: signatureAlt, strategy: `compact-offset-${offset / 2}`, priority: 6 });
      }
    }
  }

  if (candidates.length === 0) {
    return { extracted: false };
  }

  // Sort by priority and return all candidates for the caller to try
  candidates.sort((a, b) => a.priority - b.priority);
  
  // Return all unique signatures to try
  const allSigs: Array<{ sig: `0x${string}`; strategy: string }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!seen.has(c.sig)) {
      seen.add(c.sig);
      allSigs.push({ sig: c.sig, strategy: c.strategy });
    }
    if (c.alt && !seen.has(c.alt)) {
      seen.add(c.alt);
      allSigs.push({ sig: c.alt, strategy: c.strategy + "-alt" });
    }
  }

  return {
    extracted: true,
    signatures: allSigs,
    strategy: allSigs[0]?.strategy,
    extractedLen: 132,
  };
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
        // Oversized signature - try to extract valid signature from wrapper
        if (hexPart.length > 130) {
          const extraction = tryExtractSignature(sig);
          if (extraction.extracted && extraction.signatures && extraction.signatures.length > 0) {
            // Return the first candidate, with all others available for retry
            const primary = extraction.signatures[0];
            const alternatives = extraction.signatures.slice(1).map(s => s.sig);
            return {
              ok: true,
              signature: primary.sig,
              signatureAlt: alternatives[0], // First alternative for simple retry
              allCandidates: extraction.signatures, // All candidates for exhaustive retry
              kind: `hex-0x-extracted-${primary.strategy}`,
              rawLength: sig.length,
              normalizedLength: primary.sig.length,
              compactApplied: primary.strategy?.includes("compact") ?? false,
            };
          }
        }
        return {
          ok: false,
          error: `Unsupported signature length: ${hexPart.length / 2} bytes (tried extraction)`,
          kind: "hex-0x-oversized",
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
