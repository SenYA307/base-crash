import crypto from "crypto";
import { isAddress, verifyMessage } from "viem";
import { normalizeSignature } from "./signature";

const NONCE_EXPIRY_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

type NonceEntry = {
  address: string;
  issuedAt: string;
};

const nonceStore = new Map<string, NonceEntry>();

function getAuthSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw new Error("AUTH_TOKEN_SECRET is not set");
  }
  return secret;
}

function buildMessageToSign(address: string, nonce: string, issuedAt: string) {
  return [
    "Base Crash wants you to sign in with your wallet.",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export function issueNonce(address: string) {
  if (!isAddress(address)) {
    throw new Error("Invalid address");
  }
  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const messageToSign = buildMessageToSign(address, nonce, issuedAt);
  nonceStore.set(nonce, { address: address.toLowerCase(), issuedAt });

  return { nonce, issuedAt, messageToSign };
}

// Structured result type for verifySignature
export type VerifyResult =
  | {
      ok: true;
      kind: string;
      compactApplied: boolean;
    }
  | {
      ok: false;
      error: string;
      errorCode: string;
      detectedKind: string;
      rawLen: number | null;
      normalizedLen: number | null;
    };

export async function verifySignature(params: {
  address: string;
  signature: unknown;
  nonce: string;
}): Promise<VerifyResult> {
  const { address, signature, nonce } = params;

  // Validate address
  if (!isAddress(address)) {
    return {
      ok: false,
      error: "Invalid address",
      errorCode: "INVALID_ADDRESS",
      detectedKind: "n/a",
      rawLen: null,
      normalizedLen: null,
    };
  }

  // Validate nonce
  const entry = nonceStore.get(nonce);
  if (!entry) {
    return {
      ok: false,
      error: "Nonce not found",
      errorCode: "NONCE_NOT_FOUND",
      detectedKind: "n/a",
      rawLen: null,
      normalizedLen: null,
    };
  }
  if (entry.address !== address.toLowerCase()) {
    return {
      ok: false,
      error: "Nonce address mismatch",
      errorCode: "NONCE_MISMATCH",
      detectedKind: "n/a",
      rawLen: null,
      normalizedLen: null,
    };
  }
  const issuedAtMs = Date.parse(entry.issuedAt);
  if (Number.isNaN(issuedAtMs) || Date.now() - issuedAtMs > NONCE_EXPIRY_MS) {
    nonceStore.delete(nonce);
    return {
      ok: false,
      error: "Nonce expired",
      errorCode: "NONCE_EXPIRED",
      detectedKind: "n/a",
      rawLen: null,
      normalizedLen: null,
    };
  }

  // Normalize signature (robust server-side handling)
  const normResult = normalizeSignature(signature);

  if (!normResult.ok) {
    return {
      ok: false,
      error: `Signature format not recognized: ${normResult.error}`,
      errorCode: "SIG_FORMAT",
      detectedKind: normResult.kind,
      rawLen: normResult.rawLength ?? null,
      normalizedLen: null,
    };
  }

  // Build exact message that was signed
  const message = buildMessageToSign(address, nonce, entry.issuedAt);
  const typedAddress = address as `0x${string}`;

  try {
    const verified = await verifyMessage({
      address: typedAddress,
      message,
      signature: normResult.signature,
    });
    if (!verified) {
      nonceStore.delete(nonce);
      return {
        ok: false,
        error: "Invalid signature",
        errorCode: "INVALID_SIG",
        detectedKind: normResult.kind,
        rawLen: normResult.rawLength ?? null,
        normalizedLen: normResult.normalizedLength ?? null,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    nonceStore.delete(nonce);
    return {
      ok: false,
      error: errMsg.includes("invalid signature length")
        ? "Signature format not recognized"
        : `Signature verification failed: ${errMsg}`,
      errorCode: errMsg.includes("invalid signature length")
        ? "SIG_FORMAT"
        : "VERIFY_FAILED",
      detectedKind: normResult.kind,
      rawLen: normResult.rawLength ?? null,
      normalizedLen: normResult.normalizedLength ?? null,
    };
  }

  nonceStore.delete(nonce);
  return {
    ok: true,
    kind: normResult.kind,
    compactApplied: normResult.compactApplied ?? false,
  };
}

type TokenPayload = {
  address: string;
  iat: number;
  exp: number;
};

export function signAuthToken(address: string) {
  const secret = getAuthSecret();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_EXPIRY_SECONDS;
  const payload: TokenPayload = { address: address.toLowerCase(), iat, exp };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");
  const token = `${payloadEncoded}.${signature}`;
  return { token, address: payload.address, expiresAt: exp };
}

export function verifyAuthToken(token: string): TokenPayload | null {
  const secret = getAuthSecret();
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
    ) as TokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
