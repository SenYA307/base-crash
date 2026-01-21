"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { TileBoard, Coord, TokenType, TileMovement, PowerType } from "@/game";
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

// Swipe settings
const SWIPE_THRESHOLD = 22; // pixels - slightly reduced for responsiveness

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
  onSwap?: (from: Coord, to: Coord) => void;
  onAnimationComplete: () => void;
};

function isHintCell(coord: Coord, hintCells: Coord[]): boolean {
  return hintCells.some((h) => h.row === coord.row && h.col === coord.col);
}

function PowerIndicator({ power }: { power?: PowerType }) {
  if (!power) return null;

  const getIndicator = () => {
    switch (power) {
      case "row":
        return "↔"; // horizontal line
      case "col":
        return "↕"; // vertical line
      case "bomb":
        return "💥"; // bomb
      default:
        return null;
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="text-lg font-bold text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]">
        {getIndicator()}
      </span>
    </div>
  );
}

function TileImage({ token, power }: { token: TokenType; power?: PowerType }) {
  const [hasError, setHasError] = useState(failedIcons.has(token));

  if (hasError || !activeTokenSet.has(token)) {
    return (
      <div
        className={`tile-fallback relative ${power ? "ring-2 ring-white/50 animate-pulse" : ""}`}
        style={{ backgroundColor: TOKEN_COLORS[token] || "#555" }}
      >
        {TOKEN_LABELS[token] || "?"}
        <PowerIndicator power={power} />
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full ${power ? "ring-2 ring-white/50 rounded-lg" : ""}`}>
      <img
        src={getTokenIconSrc(token)}
        alt={token}
        className={`tile-image ${power ? "animate-pulse" : ""}`}
        draggable={false}
        onError={() => {
          failedIcons.add(token);
          setHasError(true);
        }}
      />
      <PowerIndicator power={power} />
    </div>
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
  onSwap,
  onAnimationComplete,
}: TokenGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(0);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Swipe state
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    coord: Coord;
    pointerId: number;
  } | null>(null);
  const hasSwipedRef = useRef(false);
  const [pressedCoord, setPressedCoord] = useState<Coord | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, coord: Coord) => {
      if (disabled || animationPhase !== "idle") return;

      // Capture pointer for reliable tracking even if finger moves off element
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      swipeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        coord,
        pointerId: e.pointerId,
      };
      hasSwipedRef.current = false;
      setPressedCoord(coord);
    },
    [disabled, animationPhase]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (
        !swipeStartRef.current ||
        hasSwipedRef.current ||
        disabled ||
        animationPhase !== "idle"
      )
        return;

      // Prevent any scroll while swiping
      e.preventDefault();

      const dx = e.clientX - swipeStartRef.current.x;
      const dy = e.clientY - swipeStartRef.current.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return;

      hasSwipedRef.current = true;
      setPressedCoord(null);
      const from = swipeStartRef.current.coord;
      let to: Coord;

      if (absDx > absDy) {
        // Horizontal swipe
        to = { row: from.row, col: from.col + (dx > 0 ? 1 : -1) };
      } else {
        // Vertical swipe
        to = { row: from.row + (dy > 0 ? 1 : -1), col: from.col };
      }

      // Bounds check
      if (
        to.row >= 0 &&
        to.row < GRID_SIZE &&
        to.col >= 0 &&
        to.col < GRID_SIZE
      ) {
        if (onSwap) {
          onSwap(from, to);
        }
      }

      swipeStartRef.current = null;
    },
    [disabled, animationPhase, onSwap]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Release pointer capture
    if (swipeStartRef.current?.pointerId === e.pointerId) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if already released
      }
    }
    swipeStartRef.current = null;
    setPressedCoord(null);
  }, []);

  const handlePointerCancel = useCallback(() => {
    swipeStartRef.current = null;
    setPressedCoord(null);
  }, []);

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
      className="rounded-2xl border border-white/10 bg-[#0f1730] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden touch-none select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerCancel}
      onPointerCancel={handlePointerCancel}
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

            const isPressed =
              pressedCoord?.row === rowIndex && pressedCoord?.col === colIndex;

            return (
              <button
                key={tile.id}
                type="button"
                disabled={disabled || isAnimating}
                onClick={() => !hasSwipedRef.current && onCellClick(coord)}
                onPointerDown={(e) => handlePointerDown(e, coord)}
                className={`tile-cell aspect-square ${
                  shouldAnimate ? "" : "tile-animate"
                } ${isSelected ? "tile-selected" : ""} ${
                  isAdjacentToSelected && !isSelected ? "tile-adjacent" : ""
                } ${isHint ? "hint-highlight" : ""} ${
                  disabled || isAnimating ? "pointer-events-none" : ""
                } ${isPressed ? "tile-pressed" : ""}`}
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
