// Token types used in the game
export type TokenType =
  | "USDC"
  | "AERO"
  | "OWB"
  | "CBBTC"
  | "ETH"
  | "ZORA"
  | "DEGEN"
  | "BRETT";

export type Coord = { row: number; col: number };

// Tile with stable ID for animation tracking
export type Tile = {
  id: string;
  token: TokenType;
};

// Board is a 2D array of Tiles (row-major)
export type TileBoard = Tile[][];

// Legacy Board type for backwards compatibility
export type Board = TokenType[][];

export type MatchEvent = {
  token: TokenType;
  length: number;
  cells: Coord[];
};

// Movement plan for animation
export type TileMovement = {
  tileId: string;
  col: number;
  fromRow: number;
  toRow: number;
  isNew: boolean;
};

export type ResolveStep = {
  matches: MatchEvent[];
  clearedCells: Coord[];
  pointsAdded: number;
  movements: TileMovement[];
};

export type GameState = {
  board: TileBoard;
  score: number;
  moves: number;
  selected: Coord | null;
};
