import type { TileBoard, Coord, GameState, ResolveStep, TileMovement, Board } from "./types";
import { INITIAL_MOVES } from "./constants";
import {
  createTileBoardNoMatches,
  cloneTileBoard,
  swapTileCells,
  areAdjacent,
  clearTileCells,
  applyGravityWithMovements,
  refillBoardWithMovements,
  hasAnyValidMove as boardHasAnyValidMove,
  findHintMove as boardFindHintMove,
  tileBoardToBoard,
} from "./board";
import { findMatches } from "./matches";
import { calculateStepPoints } from "./scoring";

/**
 * Create a fresh game state.
 * Ensures no initial matches and at least one valid move.
 */
export function createInitialState(seed?: number): GameState {
  let board = createTileBoardNoMatches(seed);
  let attempts = 0;

  // Ensure board has no matches and has at least one valid move
  while (
    (findMatches(tileBoardToBoard(board)).length > 0 ||
      !boardHasAnyValidMove(board)) &&
    attempts < 100
  ) {
    board = createTileBoardNoMatches(
      seed !== undefined ? seed + attempts + 1 : undefined
    );
    attempts++;
  }

  return {
    board,
    score: 0,
    moves: INITIAL_MOVES,
    selected: null,
  };
}

/**
 * Reshuffle the board to have no matches and at least one valid move.
 */
export function reshuffle(board: TileBoard): TileBoard {
  let newBoard = createTileBoardNoMatches();
  let attempts = 0;
  while (
    (findMatches(tileBoardToBoard(newBoard)).length > 0 ||
      !boardHasAnyValidMove(newBoard)) &&
    attempts < 100
  ) {
    newBoard = createTileBoardNoMatches();
    attempts++;
  }
  return newBoard;
}

/**
 * Apply a swap and resolve cascades.
 * Returns the new state, the resolve steps with movement plans, whether a move was consumed, and whether reshuffle occurred.
 */
export function applySwap(
  state: GameState,
  from: Coord,
  to: Coord
): {
  nextState: GameState;
  steps: ResolveStep[];
  didConsumeMove: boolean;
  didReshuffle: boolean;
} {
  // Check adjacency
  if (!areAdjacent(from, to)) {
    return {
      nextState: state,
      steps: [],
      didConsumeMove: false,
      didReshuffle: false,
    };
  }

  // Clone board and try swap
  let board = cloneTileBoard(state.board);
  swapTileCells(board, from, to);

  // Check if this creates any matches
  let matches = findMatches(tileBoardToBoard(board));
  if (matches.length === 0) {
    // Invalid swap, revert
    return {
      nextState: { ...state, selected: null },
      steps: [],
      didConsumeMove: false,
      didReshuffle: false,
    };
  }

  // Valid swap - resolve cascades
  const steps: ResolveStep[] = [];
  let totalScore = state.score;
  let cascadeStep = 1;

  while (matches.length > 0) {
    // Collect all cells to clear
    const clearedCells: Coord[] = [];
    const clearedSet = new Set<string>();
    for (const match of matches) {
      for (const cell of match.cells) {
        const key = `${cell.row},${cell.col}`;
        if (!clearedSet.has(key)) {
          clearedSet.add(key);
          clearedCells.push(cell);
        }
      }
    }

    // Calculate points for this step
    const pointsAdded = calculateStepPoints(matches, cascadeStep);
    totalScore += pointsAdded;

    // Clear cells
    const boardWithNulls = clearTileCells(board, clearedCells);

    // Apply gravity and get movements
    const gravityMovements = applyGravityWithMovements(boardWithNulls);

    // Refill and get new tile movements
    const refillMovements = refillBoardWithMovements(boardWithNulls);

    // Combine all movements for this step
    const movements: TileMovement[] = [...gravityMovements, ...refillMovements];

    steps.push({
      matches,
      clearedCells,
      pointsAdded,
      movements,
    });

    // Cast back to TileBoard after refill
    board = boardWithNulls as TileBoard;

    // Check for new matches (cascade)
    matches = findMatches(tileBoardToBoard(board));
    cascadeStep++;
  }

  // Check if board has valid moves after resolution
  let didReshuffle = false;
  if (!boardHasAnyValidMove(board)) {
    board = reshuffle(board);
    didReshuffle = true;
  }

  return {
    nextState: {
      board,
      score: totalScore,
      moves: state.moves - 1,
      selected: null,
    },
    steps,
    didConsumeMove: true,
    didReshuffle,
  };
}

export {
  boardHasAnyValidMove as hasAnyValidMove,
  boardFindHintMove as findHintMove,
};
export { findMatches } from "./matches";

// Helper to get token board for rendering
export function getBoardTokens(board: TileBoard): Board {
  return tileBoardToBoard(board);
}
