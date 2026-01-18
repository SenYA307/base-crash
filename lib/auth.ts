import crypto from "crypto";
import { isAddress, verifyMessage } from "viem";

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

export async function verifySignature(params: {
  address: string;
  signature: string;
  nonce: string;
}) {
  const { address, signature, nonce } = params;
  if (!isAddress(address)) {
    throw new Error("Invalid address");
  }
  const entry = nonceStore.get(nonce);
  if (!entry) {
    throw new Error("Nonce not found");
  }
  if (entry.address !== address.toLowerCase()) {
    throw new Error("Nonce address mismatch");
  }
  const issuedAtMs = Date.parse(entry.issuedAt);
  if (Number.isNaN(issuedAtMs) || Date.now() - issuedAtMs > NONCE_EXPIRY_MS) {
    nonceStore.delete(nonce);
    throw new Error("Nonce expired");
  }

  const message = buildMessageToSign(address, nonce, entry.issuedAt);
  const typedAddress = address as `0x${string}`;
  const typedSignature = signature as `0x${string}`;
  const verified = await verifyMessage({
    address: typedAddress,
    message,
    signature: typedSignature,
  });
  if (!verified) {
    throw new Error("Invalid signature");
  }
  nonceStore.delete(nonce);
  return true;
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
