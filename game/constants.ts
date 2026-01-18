import type { TokenType } from "./types";

export const GRID_SIZE = 9;
export const INITIAL_MOVES = 30;

// Number of different token types to use (1-8)
// Fewer types = easier matching, more types = harder
export const TOKEN_VARIETY = 6;

// Full list of available tokens (in priority order)
export const TOKEN_LIST: TokenType[] = [
  "USDC",
  "AERO",
  "OWB",
  "CBBTC",
  "ETH",
  "ZORA",
  "DEGEN",
  "BRETT",
];

// Active tokens based on TOKEN_VARIETY
export const ACTIVE_TOKENS: TokenType[] = TOKEN_LIST.slice(0, TOKEN_VARIETY);
