import type { MatchEvent } from "./types";

/**
 * Calculate points for a single match event.
 */
export function pointsForMatch(length: number): number {
  if (length === 3) return 100;
  if (length === 4) return 200;
  if (length === 5) return 400;
  // length >= 6
  return 400 + 150 * (length - 5);
}

/**
 * Get the cascade multiplier for a given cascade step (1-indexed).
 */
export function cascadeMultiplier(step: number): number {
  if (step <= 1) return 1.0;
  if (step === 2) return 1.25;
  if (step === 3) return 1.5;
  if (step === 4) return 1.75;
  return 2.0; // step >= 5
}

/**
 * Calculate total points for a set of matches at a given cascade step.
 */
export function calculateStepPoints(
  matches: MatchEvent[],
  step: number
): number {
  const basePoints = matches.reduce(
    (sum, m) => sum + pointsForMatch(m.length),
    0
  );
  return Math.round(basePoints * cascadeMultiplier(step));
}
