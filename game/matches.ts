import type { Board, Coord, MatchEvent, PowerType } from "./types";
import { GRID_SIZE } from "./constants";

/**
 * Determine if a match should spawn a power tile, and where.
 * - Match-5+: Bomb (spawns at middle cell)
 * - Match-4: Row clear (horizontal) or Col clear (vertical)
 * - Match-3: No power
 */
function getPowerForMatch(
  cells: Coord[],
  isHorizontal: boolean
): { powerType: PowerType; spawnCell: Coord } | null {
  if (cells.length >= 5) {
    // Bomb for match-5+
    const midIndex = Math.floor(cells.length / 2);
    return { powerType: "bomb", spawnCell: cells[midIndex] };
  }
  if (cells.length === 4) {
    // Row/col clear for match-4
    const midIndex = Math.floor(cells.length / 2);
    return {
      powerType: isHorizontal ? "row" : "col",
      spawnCell: cells[midIndex],
    };
  }
  return null;
}

/**
 * Find all matches (3+ in a row/col) on the board.
 * Returns an array of MatchEvent with power tile info.
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
        // Check if any cell in this run is already part of a match
        const alreadyVisited = cells.some((cell) =>
          visited.has(key(cell.row, cell.col))
        );
        if (!alreadyVisited) {
          const power = getPowerForMatch(cells, true);
          matches.push({
            token,
            length: cells.length,
            cells,
            powerSpawnCell: power?.spawnCell,
            powerType: power?.powerType,
          });
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
        const power = getPowerForMatch(cells, false);
        matches.push({
          token,
          length: cells.length,
          cells,
          powerSpawnCell: power?.spawnCell,
          powerType: power?.powerType,
        });
      }
      row = r;
    }
  }

  return matches;
}
