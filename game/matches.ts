import type { Board, Coord, MatchEvent } from "./types";
import { GRID_SIZE } from "./constants";

/**
 * Find all matches (3+ in a row/col) on the board.
 * Returns an array of MatchEvent.
 */
export function findMatches(board: Board): MatchEvent[] {
  const matches: MatchEvent[] = [];
  const visited = new Set<string>();

  const key = (r: number, c: number) => `${r},${c}`;

  // Horizontal matches
  for (let row = 0; row < GRID_SIZE; row++) {
    let col = 0;
    while (col < GRID_SIZE) {
      const token = board[row][col];
      const cells: Coord[] = [{ row, col }];
      let c = col + 1;
      while (c < GRID_SIZE && board[row][c] === token) {
        cells.push({ row, col: c });
        c++;
      }
      if (cells.length >= 3) {
        // Check if any cell in this run is already part of a match (for dedup later)
        const alreadyVisited = cells.some((cell) =>
          visited.has(key(cell.row, cell.col))
        );
        if (!alreadyVisited) {
          matches.push({ token, length: cells.length, cells });
          cells.forEach((cell) => visited.add(key(cell.row, cell.col)));
        }
      }
      col = c;
    }
  }

  // Vertical matches
  for (let col = 0; col < GRID_SIZE; col++) {
    let row = 0;
    while (row < GRID_SIZE) {
      const token = board[row][col];
      const cells: Coord[] = [{ row, col }];
      let r = row + 1;
      while (r < GRID_SIZE && board[r][col] === token) {
        cells.push({ row: r, col });
        r++;
      }
      if (cells.length >= 3) {
        // For vertical, we might overlap with horizontal matches; that's fine,
        // we'll dedupe cleared cells later
        matches.push({ token, length: cells.length, cells });
      }
      row = r;
    }
  }

  return matches;
}
