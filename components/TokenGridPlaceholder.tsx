"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { TileBoard, Coord, TokenType, TileMovement } from "@/game";
import { GRID_SIZE, ACTIVE_TOKENS, areAdjacent } from "@/game";

// Token color map for fallback
const TOKEN_COLORS: Record<TokenType, string> = {
  USDC: "#2775CA",
  AERO: "#00C2FF",
  OWB: "#FF6B35",
  CBBTC: "#F7931A",
  ETH: "#627EEA",
  ZORA: "#5C5CFF",
  DEGEN: "#A36EFD",
  BRETT: "#00D395",
};

const TOKEN_LABELS: Record<TokenType, string> = {
  USDC: "U",
  AERO: "A",
  OWB: "O",
  CBBTC: "B",
  ETH: "E",
  ZORA: "Z",
  DEGEN: "D",
  BRETT: "R",
};

function getTokenIconSrc(token: TokenType): string {
  return `/assets/tokens/${token.toLowerCase()}.png`;
}

const failedIcons = new Set<TokenType>();
const activeTokenSet = new Set(ACTIVE_TOKENS);

// Animation timing
const SWAP_DURATION = 280;
const DROP_DURATION_PER_CELL = 60;
const MIN_DROP_DURATION = 180;
const MAX_DROP_DURATION = 380;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export type AnimationPhase =
  | "idle"
  | "swapping"
  | "swap_back"
  | "dropping"
  | "spawning";

export type SwapPair = {
  from: Coord;
  to: Coord;
} | null;

type TokenGridProps = {
  board: TileBoard;
  selected: Coord | null;
  hintCells: Coord[];
  disabled: boolean;
  animationPhase: AnimationPhase;
  swapPair: SwapPair;
  movements: TileMovement[];
  onCellClick: (coord: Coord) => void;
  onAnimationComplete: () => void;
};

function isHintCell(coord: Coord, hintCells: Coord[]): boolean {
  return hintCells.some((h) => h.row === coord.row && h.col === coord.col);
}

function TileImage({ token }: { token: TokenType }) {
  const [hasError, setHasError] = useState(failedIcons.has(token));

  if (hasError || !activeTokenSet.has(token)) {
    return (
      <div
        className="tile-fallback"
        style={{ backgroundColor: TOKEN_COLORS[token] || "#555" }}
      >
        {TOKEN_LABELS[token] || "?"}
      </div>
    );
  }

  return (
    <img
      src={getTokenIconSrc(token)}
      alt={token}
      className="tile-image"
      draggable={false}
      onError={() => {
        failedIcons.add(token);
        setHasError(true);
      }}
    />
  );
}

export default function TokenGridPlaceholder({
  board,
  selected,
  hintCells,
  disabled,
  animationPhase,
  swapPair,
  movements,
  onCellClick,
  onAnimationComplete,
}: TokenGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(0);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate cell size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const gap = 4;
        const size = (containerWidth - gap * (GRID_SIZE - 1)) / GRID_SIZE;
        setCellSize(size + gap);
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Handle animation completion via timeout
  useEffect(() => {
    if (animationPhase === "idle") return;

    // Clear any existing timeout
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    let duration = 0;

    if (animationPhase === "swapping" || animationPhase === "swap_back") {
      duration = SWAP_DURATION + 50;
    } else if (animationPhase === "dropping" || animationPhase === "spawning") {
      // Calculate max drop distance
      let maxDistance = 1;
      for (const m of movements) {
        const dist = Math.abs(m.fromRow - m.toRow);
        if (dist > maxDistance) maxDistance = dist;
      }
      duration =
        Math.min(
          MAX_DROP_DURATION,
          Math.max(MIN_DROP_DURATION, maxDistance * DROP_DURATION_PER_CELL)
        ) + 50;
    }

    if (duration > 0) {
      animationTimeoutRef.current = setTimeout(() => {
        onAnimationComplete();
      }, duration);
    }

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [animationPhase, movements, onAnimationComplete]);

  // Build movement lookup
  const movementMap = new Map<string, TileMovement>();
  for (const m of movements) {
    movementMap.set(m.tileId, m);
  }

  const isAnimating = animationPhase !== "idle";

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-white/10 bg-[#0f1730] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden"
    >
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}
      >
        {board.map((row, rowIndex) =>
          row.map((tile, colIndex) => {
            const coord = { row: rowIndex, col: colIndex };
            const isSelected =
              selected?.row === rowIndex && selected?.col === colIndex;
            const isAdjacentToSelected =
              selected !== null && areAdjacent(selected, coord);
            const isHint = isHintCell(coord, hintCells);

            // Calculate transform for animations
            let transform = "translate3d(0, 0, 0)";
            let transitionDuration = "0ms";
            let isSwapping = false;

            // Swap animation
            if (
              (animationPhase === "swapping" ||
                animationPhase === "swap_back") &&
              swapPair &&
              cellSize > 0
            ) {
              const { from, to } = swapPair;
              const isFrom = from.row === rowIndex && from.col === colIndex;
              const isTo = to.row === rowIndex && to.col === colIndex;

              if (isFrom || isTo) {
                isSwapping = true;
                transitionDuration = `${SWAP_DURATION}ms`;

                if (animationPhase === "swapping") {
                  // Animate to swapped position
                  if (isFrom) {
                    const dx = (to.col - from.col) * cellSize;
                    const dy = (to.row - from.row) * cellSize;
                    transform = `translate3d(${dx}px, ${dy}px, 0)`;
                  } else {
                    const dx = (from.col - to.col) * cellSize;
                    const dy = (from.row - to.row) * cellSize;
                    transform = `translate3d(${dx}px, ${dy}px, 0)`;
                  }
                }
                // swap_back: transform stays at origin (0,0,0)
              }
            }

            // Drop/spawn animation
            if (
              (animationPhase === "dropping" ||
                animationPhase === "spawning") &&
              cellSize > 0
            ) {
              const movement = movementMap.get(tile.id);
              if (movement) {
                const rowDiff = movement.fromRow - movement.toRow;
                const offsetY = rowDiff * cellSize;
                transform = `translate3d(0, ${offsetY}px, 0)`;

                const distance = Math.abs(rowDiff);
                const duration = Math.min(
                  MAX_DROP_DURATION,
                  Math.max(MIN_DROP_DURATION, distance * DROP_DURATION_PER_CELL)
                );
                transitionDuration = `${duration}ms`;
              }
            }

            const shouldAnimate =
              isSwapping ||
              ((animationPhase === "dropping" ||
                animationPhase === "spawning") &&
                movementMap.has(tile.id));

            return (
              <button
                key={tile.id}
                type="button"
                disabled={disabled || isAnimating}
                onClick={() => onCellClick(coord)}
                className={`tile-cell aspect-square ${
                  shouldAnimate ? "" : "tile-animate"
                } ${isSelected ? "tile-selected" : ""} ${
                  isAdjacentToSelected && !isSelected ? "tile-adjacent" : ""
                } ${isHint ? "hint-highlight" : ""} ${
                  disabled || isAnimating ? "pointer-events-none" : ""
                }`}
                style={{
                  transform,
                  transition: shouldAnimate
                    ? `transform ${transitionDuration} ${EASING}`
                    : undefined,
                }}
              >
                <TileImage token={tile.token} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
