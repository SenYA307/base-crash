import type { TileBoard, Coord, GameState, ResolveStep, TileMovement, Board, PowerType } from "./types";
import { INITIAL_MOVES, GRID_SIZE } from "./constants";
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
import { calculateStepPoints, pointsForPowerActivation } from "./scoring";

/**
 * Get cells affected by power tile activation.
 */
function getPowerAffectedCells(
  board: TileBoard,
  cell: Coord,
  power: PowerType
): Coord[] {
  const cells: Coord[] = [];
  
  if (power === "row") {
    // Clear entire row
    for (let col = 0; col < GRID_SIZE; col++) {
      cells.push({ row: cell.row, col });
    }
  } else if (power === "col") {
    // Clear entire column
    for (let row = 0; row < GRID_SIZE; row++) {
      cells.push({ row, col: cell.col });
    }
  } else if (power === "bomb") {
    // Clear 3x3 area
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = cell.row + dr;
        const c = cell.col + dc;
        if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
          cells.push({ row: r, col: c });
        }
      }
    }
  }
  
  return cells;
}

/**
 * Check if a swap involves a power tile and return activated powers.
 */
function checkPowerActivation(
  board: TileBoard,
  from: Coord,
  to: Coord
): { cell: Coord; power: PowerType }[] {
  const activations: { cell: Coord; power: PowerType }[] = [];
  
  const fromTile = board[from.row][from.col];
  const toTile = board[to.row][to.col];
  
  if (fromTile.power) {
    activations.push({ cell: from, power: fromTile.power });
  }
  if (toTile.power) {
    activations.push({ cell: to, power: toTile.power });
  }
  
  return activations;
}

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
  
  // Check for power tile activation BEFORE swap
  const powerActivations = checkPowerActivation(board, from, to);
  
  swapTileCells(board, from, to);

  // If power tiles are activated, the swap is always valid
  let matches = findMatches(tileBoardToBoard(board));
  
  if (matches.length === 0 && powerActivations.length === 0) {
    // Invalid swap, revert
    return {
      nextState: { ...state, selected: null },
      steps: [],
      didConsumeMove: false,
      didReshuffle: false,
    };
  }

  // Handle power tile activations first (add their affected cells)
  if (powerActivations.length > 0) {
    const powerClearedCells: Coord[] = [];
    const powerClearedSet = new Set<string>();
    let powerPoints = 0;

    for (const activation of powerActivations) {
      powerPoints += pointsForPowerActivation(activation.power);
      const affected = getPowerAffectedCells(board, activation.cell, activation.power);
      for (const cell of affected) {
        const key = `${cell.row},${cell.col}`;
        if (!powerClearedSet.has(key)) {
          powerClearedSet.add(key);
          powerClearedCells.push(cell);
        }
      }
    }

    if (powerClearedCells.length > 0) {
      // Clear power-affected cells
      const boardWithNulls = clearTileCells(board, powerClearedCells);
      const gravityMovements = applyGravityWithMovements(boardWithNulls);
      const refillMovements = refillBoardWithMovements(boardWithNulls);
      
      board = boardWithNulls as TileBoard;
      
      // Re-check for matches after power activation
      matches = findMatches(tileBoardToBoard(board));
    }
  }

  // Valid swap - resolve cascades
  const steps: ResolveStep[] = [];
  let totalScore = state.score;
  let cascadeStep = 1;

  // Track power tiles that need to spawn (delayed until after clearing)
  let pendingPowerSpawns: { cell: Coord; power: PowerType; token: string }[] = [];

  while (matches.length > 0) {
    // Collect all cells to clear
    const clearedCells: Coord[] = [];
    const clearedSet = new Set<string>();
    const powersToClear: PowerType[] = [];

    for (const match of matches) {
      for (const cell of match.cells) {
        const key = `${cell.row},${cell.col}`;
        if (!clearedSet.has(key)) {
          clearedSet.add(key);
          clearedCells.push(cell);
          
          // Check if this cell has a power tile (chain reaction)
          const tile = board[cell.row][cell.col];
          if (tile && tile.power) {
            powersToClear.push(tile.power);
            // Add cells affected by power activation
            const affectedCells = getPowerAffectedCells(board, cell, tile.power);
            for (const affected of affectedCells) {
              const affectedKey = `${affected.row},${affected.col}`;
              if (!clearedSet.has(affectedKey)) {
                clearedSet.add(affectedKey);
                clearedCells.push(affected);
              }
            }
          }
        }
      }

      // Queue power tile spawn if this match creates one
      if (match.powerSpawnCell && match.powerType) {
        const token = match.token;
        pendingPowerSpawns.push({
          cell: match.powerSpawnCell,
          power: match.powerType,
          token,
        });
      }
    }

    // Calculate points for this step (including power activation bonuses)
    let pointsAdded = calculateStepPoints(matches, cascadeStep);
    for (const power of powersToClear) {
      pointsAdded += pointsForPowerActivation(power);
    }
    totalScore += pointsAdded;

    // Clear cells
    const boardWithNulls = clearTileCells(board, clearedCells);

    // Apply gravity and get movements
    const gravityMovements = applyGravityWithMovements(boardWithNulls);

    // Refill and get new tile movements
    const refillMovements = refillBoardWithMovements(boardWithNulls);

    // After refill, spawn any power tiles at their designated cells
    // Note: The spawn cell may have been refilled with a new tile
    // We replace that tile with a power version
    for (const spawn of pendingPowerSpawns) {
      const tile = boardWithNulls[spawn.cell.row][spawn.cell.col];
      if (tile) {
        tile.power = spawn.power;
      }
    }
    pendingPowerSpawns = []; // Reset for next cascade step

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
