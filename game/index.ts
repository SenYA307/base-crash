// Re-export public API
export type {
  TokenType,
  Coord,
  Board,
  Tile,
  TileBoard,
  MatchEvent,
  ResolveStep,
  TileMovement,
  GameState,
} from "./types";

export {
  GRID_SIZE,
  INITIAL_MOVES,
  TOKEN_LIST,
  TOKEN_VARIETY,
  ACTIVE_TOKENS,
} from "./constants";

export {
  createInitialState,
  applySwap,
  reshuffle,
  hasAnyValidMove,
  findHintMove,
  findMatches,
  getBoardTokens,
} from "./engine";

export { areAdjacent, tileBoardToBoard } from "./board";
