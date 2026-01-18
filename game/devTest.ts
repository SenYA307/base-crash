/**
 * Lightweight dev-only test assertions for the Match-3 engine.
 * Run via: npx ts-node game/devTest.ts (or import in dev console)
 */
import { createInitialState, findMatches, hasAnyValidMove, applySwap } from "./engine";
import { createBoardNoMatches, cloneBoard, swapCells } from "./board";
import { pointsForMatch, cascadeMultiplier, calculateStepPoints } from "./scoring";
import type { MatchEvent } from "./types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runDevTests() {
  console.log("Running dev tests...");

  // Test 1: Initial board has no matches
  const state = createInitialState(12345);
  const matches = findMatches(state.board);
  assert(matches.length === 0, "Initial board should have no matches");
  console.log("✓ Initial board has no matches");

  // Test 2: Initial board has a valid move
  const hasMove = hasAnyValidMove(state.board);
  assert(hasMove, "Initial board should have at least one valid move");
  console.log("✓ Initial board has a valid move");

  // Test 3: Scoring examples
  // len=3 => 100
  assert(pointsForMatch(3) === 100, "len=3 should be 100 points");
  // len=4 => 200
  assert(pointsForMatch(4) === 200, "len=4 should be 200 points");
  // len=5 => 400
  assert(pointsForMatch(5) === 400, "len=5 should be 400 points");
  // len=6 => 400 + 150 = 550
  assert(pointsForMatch(6) === 550, "len=6 should be 550 points");
  console.log("✓ pointsForMatch correct");

  // Cascade multipliers
  assert(cascadeMultiplier(1) === 1.0, "step1 multiplier should be 1.0");
  assert(cascadeMultiplier(2) === 1.25, "step2 multiplier should be 1.25");
  assert(cascadeMultiplier(3) === 1.5, "step3 multiplier should be 1.5");
  assert(cascadeMultiplier(4) === 1.75, "step4 multiplier should be 1.75");
  assert(cascadeMultiplier(5) === 2.0, "step5 multiplier should be 2.0");
  assert(cascadeMultiplier(10) === 2.0, "step10 multiplier should be capped at 2.0");
  console.log("✓ cascadeMultiplier correct");

  // len=3 step1 => 100 * 1.0 = 100
  const match3: MatchEvent[] = [{ token: "USDC", length: 3, cells: [] }];
  assert(calculateStepPoints(match3, 1) === 100, "len=3 step1 should be 100");

  // len=5 step2 => 400 * 1.25 = 500
  const match5: MatchEvent[] = [{ token: "ETH", length: 5, cells: [] }];
  assert(calculateStepPoints(match5, 2) === 500, "len=5 step2 should be 500");

  // len=3 + len=4 step1 => (100 + 200) * 1.0 = 300
  const match3and4: MatchEvent[] = [
    { token: "USDC", length: 3, cells: [] },
    { token: "AERO", length: 4, cells: [] },
  ];
  assert(calculateStepPoints(match3and4, 1) === 300, "len=3+len=4 step1 should be 300");
  console.log("✓ calculateStepPoints correct");

  console.log("All dev tests passed!");
}

// Auto-run if executed directly
if (typeof require !== "undefined" && require.main === module) {
  runDevTests();
}
