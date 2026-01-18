import type { TileBoard, Tile, Coord, TokenType, TileMovement, Board } from "./types";
import { GRID_SIZE, ACTIVE_TOKENS } from "./constants";
import { findMatches } from "./matches";

let tileIdCounter = 0;

function generateTileId(): string {
  return `tile-${++tileIdCounter}-${Date.now().toString(36)}`;
}

/**
 * Simple seeded random for reproducibility (optional).
 */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomToken(rand: () => number): TokenType {
  return ACTIVE_TOKENS[Math.floor(rand() * ACTIVE_TOKENS.length)];
}

function createTile(token: TokenType): Tile {
  return { id: generateTileId(), token };
}

/**
 * Convert TileBoard to legacy Board (for match detection)
 */
export function tileBoardToBoard(tileBoard: TileBoard): Board {
  return tileBoard.map((row) => row.map((tile) => tile.token));
}

/**
 * Create a tile board with no initial matches.
 */
export function createTileBoardNoMatches(seed?: number): TileBoard {
  const rand = seed !== undefined ? mulberry32(seed) : Math.random;
  const board: TileBoard = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    board.push([]);
    for (let col = 0; col < GRID_SIZE; col++) {
      let token = randomToken(rand);
      let attempts = 0;
      // Ensure no horizontal or vertical match of 3+ at placement
      while (wouldCreateMatch(board, row, col, token) && attempts < 50) {
        token = randomToken(rand);
        attempts++;
      }
      board[row].push(createTile(token));
    }
  }

  return board;
}

function wouldCreateMatch(
  board: TileBoard,
  row: number,
  col: number,
  token: TokenType
): boolean {
  // Check horizontal (left)
  if (
    col >= 2 &&
    board[row][col - 1].token === token &&
    board[row][col - 2].token === token
  ) {
    return true;
  }
  // Check vertical (up)
  if (
    row >= 2 &&
    board[row - 1][col].token === token &&
    board[row - 2][col].token === token
  ) {
    return true;
  }
  return false;
}

/**
 * Deep clone a tile board.
 */
export function cloneTileBoard(board: TileBoard): TileBoard {
  return board.map((row) => row.map((tile) => ({ ...tile })));
}

/**
 * Apply column-based gravity and track movements.
 * Returns the movement plan for animation.
 */
export function applyGravityWithMovements(
  board: (Tile | null)[][]
): TileMovement[] {
  const movements: TileMovement[] = [];

  for (let col = 0; col < GRID_SIZE; col++) {
    // Collect non-null tiles in this column (from bottom to top)
    const columnTiles: { tile: Tile; originalRow: number }[] = [];
    for (let row = GRID_SIZE - 1; row >= 0; row--) {
      if (board[row][col] !== null) {
        columnTiles.push({ tile: board[row][col]!, originalRow: row });
      }
    }

    // Place tiles from bottom, tracking movements
    let writeRow = GRID_SIZE - 1;
    for (const { tile, originalRow } of columnTiles) {
      board[writeRow][col] = tile;
      if (writeRow !== originalRow) {
        movements.push({
          tileId: tile.id,
          col,
          fromRow: originalRow,
          toRow: writeRow,
          isNew: false,
        });
      }
      writeRow--;
    }

    // Fill remaining rows with null (to be refilled)
    for (let row = writeRow; row >= 0; row--) {
      board[row][col] = null;
    }
  }

  return movements;
}

/**
 * Refill null cells with new tiles and track their movements.
 */
export function refillBoardWithMovements(
  board: (Tile | null)[][],
  rand: () => number = Math.random
): TileMovement[] {
  const movements: TileMovement[] = [];

  for (let col = 0; col < GRID_SIZE; col++) {
    // Count nulls from top
    let spawnOffset = 0;
    for (let row = 0; row < GRID_SIZE; row++) {
      if (board[row][col] === null) {
        spawnOffset++;
      } else {
        break; // Nulls are always at top after gravity
      }
    }

    // Fill nulls with new tiles
    for (let row = 0; row < spawnOffset; row++) {
      const newTile = createTile(randomToken(rand));
      board[row][col] = newTile;
      movements.push({
        tileId: newTile.id,
        col,
        fromRow: -(spawnOffset - row), // Negative = above the grid
        toRow: row,
        isNew: true,
      });
    }
  }

  return movements;
}

/**
 * Clear cells from the board (set to null).
 */
export function clearTileCells(
  board: TileBoard,
  cells: Coord[]
): (Tile | null)[][] {
  const b = board as (Tile | null)[][];
  for (const { row, col } of cells) {
    b[row][col] = null;
  }
  return b;
}

/**
 * Check if two coordinates are adjacent.
 */
export function areAdjacent(a: Coord, b: Coord): boolean {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * Swap two cells on the tile board (mutates).
 */
export function swapTileCells(board: TileBoard, a: Coord, b: Coord): void {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}

/**
 * Check if the board has at least one valid move.
 */
export function hasAnyValidMove(board: TileBoard): boolean {
  const tokenBoard = tileBoardToBoard(board);
  // Try every possible swap of adjacent cells
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      // Check right
      if (col < GRID_SIZE - 1) {
        const testBoard = tokenBoard.map((r) => [...r]);
        const temp = testBoard[row][col];
        testBoard[row][col] = testBoard[row][col + 1];
        testBoard[row][col + 1] = temp;
        if (findMatches(testBoard).length > 0) return true;
      }
      // Check down
      if (row < GRID_SIZE - 1) {
        const testBoard = tokenBoard.map((r) => [...r]);
        const temp = testBoard[row][col];
        testBoard[row][col] = testBoard[row + 1][col];
        testBoard[row + 1][col] = temp;
        if (findMatches(testBoard).length > 0) return true;
      }
    }
  }
  return false;
}

/**
 * Find a hint move (first valid swap found).
 */
export function findHintMove(
  board: TileBoard
): { from: Coord; to: Coord } | null {
  const tokenBoard = tileBoardToBoard(board);
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      // Check right
      if (col < GRID_SIZE - 1) {
        const testBoard = tokenBoard.map((r) => [...r]);
        const temp = testBoard[row][col];
        testBoard[row][col] = testBoard[row][col + 1];
        testBoard[row][col + 1] = temp;
        if (findMatches(testBoard).length > 0) {
          return { from: { row, col }, to: { row, col: col + 1 } };
        }
      }
      // Check down
      if (row < GRID_SIZE - 1) {
        const testBoard = tokenBoard.map((r) => [...r]);
        const temp = testBoard[row][col];
        testBoard[row][col] = testBoard[row + 1][col];
        testBoard[row + 1][col] = temp;
        if (findMatches(testBoard).length > 0) {
          return { from: { row, col }, to: { row: row + 1, col } };
        }
      }
    }
  }
  return null;
}

// Legacy exports for backwards compatibility
export function createBoardNoMatches(seed?: number): Board {
  return tileBoardToBoard(createTileBoardNoMatches(seed));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function swapCells(board: Board, a: Coord, b: Coord): void {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}
