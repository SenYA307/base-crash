import crypto from "crypto";

// Referral boost configuration
export const REFERRAL_BOOST_PERCENT = 5; // +5% per activated referral
export const REFERRAL_BOOST_MULTIPLIER = 1.05;
export const REFERRAL_BOOST_DURATION_DAYS = 7;
export const MAX_BOOST_MULTIPLIER = 1.25; // Cap at 25% boost

/**
 * Generate a deterministic, stable referral code from a user ID.
 * Uses base32-like encoding for URL-safe, short codes.
 */
export function generateReferralCode(userId: string): string {
  // Create a hash of the userId
  const hash = crypto.createHash("sha256").update(userId).digest();
  
  // Take first 5 bytes and encode as base32 (8 characters)
  const base32Chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 to avoid confusion
  let code = "";
  
  for (let i = 0; i < 5; i++) {
    const byte = hash[i];
    code += base32Chars[byte % 32];
    code += base32Chars[Math.floor(byte / 32) % 32];
  }
  
  // Take first 8 characters
  return code.slice(0, 8);
}

/**
 * Calculate the boost multiplier for a user based on their activated referrals.
 * Each activated referral adds +5%, capped at 25%.
 */
export function calculateBoostMultiplier(activatedReferralCount: number): number {
  const boost = 1 + (activatedReferralCount * (REFERRAL_BOOST_PERCENT / 100));
  return Math.min(boost, MAX_BOOST_MULTIPLIER);
}

/**
 * Apply boost to a raw score.
 */
export function applyBoost(rawScore: number, multiplier: number): number {
  return Math.round(rawScore * multiplier);
}

/**
 * Get the boost expiration timestamp (7 days from now).
 */
export function getBoostExpirationTimestamp(): number {
  const now = Date.now();
  return Math.floor((now + REFERRAL_BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000) / 1000);
}

/**
 * Get the start of the current UTC week (Monday 00:00:00 UTC).
 */
export function getWeekStartUtc(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  // Sunday = 0, Monday = 1, ..., Saturday = 6
  // We want Monday to be the start
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysToSubtract);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Get the end of the current UTC week (Sunday 23:59:59 UTC).
 */
export function getWeekEndUtc(date: Date = new Date()): number {
  const weekStart = getWeekStartUtc(date);
  // Add 7 days minus 1 second
  return weekStart + (7 * 24 * 60 * 60) - 1;
}

/**
 * Get the start of the current UTC day.
 */
export function getDayStartUtc(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return Math.floor(d.getTime() / 1000);
}

/**
 * Get the end of the current UTC day.
 */
export function getDayEndUtc(date: Date = new Date()): number {
  return getDayStartUtc(date) + (24 * 60 * 60) - 1;
}
