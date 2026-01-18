"use client";

import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { createPublicClient, http, formatEther } from "viem";
import { mainnet, base } from "wagmi/chains";

import BaseHeader from "@/components/BaseHeader";
import GameHUD from "@/components/GameHUD";
import TokenGridPlaceholder, {
  type AnimationPhase,
  type SwapPair,
} from "@/components/TokenGridPlaceholder";
import AudioControls from "@/components/AudioControls";
import WelcomeModal from "@/components/WelcomeModal";
import ComboOverlay from "@/components/ComboOverlay";
import GMStreakView from "@/components/GMStreakView";
import {
  createInitialState,
  applySwap,
  findHintMove,
  areAdjacent,
  INITIAL_MOVES,
  type GameState,
  type Coord,
  type TileMovement,
} from "@/game";
import {
  initAudio,
  tryStartBgm,
  playSwap,
  playMatch,
  playCascade,
  playGameOver,
  isInitialized as isAudioInitialized,
} from "@/lib/audio";

// Hint constants
const HINT_COOLDOWN_MS = 12000;
const FREE_HINTS_PER_RUN = 3;
const HINT_DISPLAY_MS = 1500;
const HINTS_PACK_SIZE = 3;

type View = "home" | "game" | "leaderboard" | "gm";

type FloatingScore = {
  id: number;
  points: number;
};

type LeaderboardEntry = {
  rank: number;
  address: string;
  score: number;
  created_at: number;
};

type PendingSwap = {
  from: Coord;
  to: Coord;
  originalState: GameState;
  nextState: GameState;
  steps: { movements: TileMovement[]; pointsAdded: number }[];
  didReshuffle: boolean;
  isValid: boolean;
};

type HintPurchaseState =
  | "idle"
  | "creating_intent"
  | "awaiting_signature"
  | "pending"
  | "verifying"
  | "success"
  | "error";

const AUTH_STORAGE_KEY = "base-crash-auth";

function shortAddress(address?: string | null) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function generateRunId(): string {
  return crypto.randomUUID();
}

// ENS resolution client (mainnet)
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameStartAt, setGameStartAt] = useState<number | null>(null);
  const [runId, setRunId] = useState<string>("");

  // UI state
  const [showWelcome, setShowWelcome] = useState(true);
  const [comboMultiplier, setComboMultiplier] = useState(0);

  // Hint state
  const [hintCells, setHintCells] = useState<Coord[]>([]);
  const [freeHintsUsed, setFreeHintsUsed] = useState(0);
  const [purchasedHintsRemaining, setPurchasedHintsRemaining] = useState(0);
  const [hintCooldownEnd, setHintCooldownEnd] = useState(0);
  const hintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hint purchase state
  const [hintPurchaseState, setHintPurchaseState] =
    useState<HintPurchaseState>("idle");
  const [purchaseIntent, setPurchaseIntent] = useState<{
    intentToken: string;
    requiredWei: string;
    treasuryAddress: string;
  } | null>(null);
  const [purchaseTxHash, setPurchaseTxHash] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // UX state
  const [toast, setToast] = useState<string | null>(null);
  const [floatingScores, setFloatingScores] = useState<FloatingScore[]>([]);
  const floatingIdRef = useRef(0);

  // Animation state machine
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>("idle");
  const [swapPair, setSwapPair] = useState<SwapPair>(null);
  const [movements, setMovements] = useState<TileMovement[]>([]);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);

  // Wallet + auth state
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChain } = useSwitchChain();
  const {
    sendTransaction,
    data: txHash,
    isPending: isTxPending,
    error: txError,
    reset: resetTx,
  } = useSendTransaction();

  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authAddress, setAuthAddress] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Leaderboard state
  const [leaderboardMode, setLeaderboardMode] =
    useState<"daily" | "alltime">("daily");
  const [leaderboardResults, setLeaderboardResults] = useState<
    LeaderboardEntry[]
  >([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [ensNames, setEnsNames] = useState<Map<string, string | null>>(
    new Map()
  );

  // Computed values
  const remainingHints =
    Math.max(0, FREE_HINTS_PER_RUN - freeHintsUsed) + purchasedHintsRemaining;
  const isOnBase = chainId === base.id;

  const clearAuth = useCallback(() => {
    setAuthToken(null);
    setAuthAddress(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  useEffect(() => {
    sdk.actions.ready();
  }, []);

  // Load auth token from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        token: string;
        address: string;
        expiresAt: number;
      };
      if (parsed.expiresAt < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
      setAuthToken(parsed.token);
      setAuthAddress(parsed.address);
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  // Clear auth if wallet address changes
  useEffect(() => {
    if (!address || !authAddress) return;
    if (address.toLowerCase() !== authAddress.toLowerCase()) {
      clearAuth();
    }
  }, [address, authAddress, clearAuth]);

  // Clear hint on unmount
  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    };
  }, []);

  // Handle tx confirmation for hint purchase
  useEffect(() => {
    if (
      isTxConfirmed &&
      txHash &&
      hintPurchaseState === "pending" &&
      purchaseIntent
    ) {
      // Transaction confirmed, verify on server
      verifyHintPurchase(txHash);
    }
  }, [isTxConfirmed, txHash, hintPurchaseState, purchaseIntent]);

  // Handle tx error
  useEffect(() => {
    if (txError && hintPurchaseState === "awaiting_signature") {
      setPurchaseError(txError.message || "Transaction rejected");
      setHintPurchaseState("error");
    }
  }, [txError, hintPurchaseState]);

  const clearHint = useCallback(() => {
    setHintCells([]);
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = null;
    }
  }, []);

  const showToast = useCallback((message: string, durationMs = 2000) => {
    setToast(message);
    setTimeout(() => setToast(null), durationMs);
  }, []);

  const showFloatingScore = useCallback((points: number) => {
    const id = floatingIdRef.current++;
    setFloatingScores((prev) => [...prev, { id, points }]);
    setTimeout(() => {
      setFloatingScores((prev) => prev.filter((f) => f.id !== id));
    }, 1100);
  }, []);

  const handleConnect = useCallback(() => {
    if (isConnected) {
      disconnect();
      clearAuth();
      return;
    }
    const injectedConnector = connectors.find((c) => c.id === "injected");
    const connector = injectedConnector || connectors[0];
    if (connector) {
      connect({ connector });
    }
  }, [connect, connectors, disconnect, isConnected, clearAuth]);

  const handleSignIn = useCallback(async () => {
    if (!address) {
      showToast("Connect wallet first");
      return;
    }
    try {
      setIsSigningIn(true);
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) {
        throw new Error(nonceData.error || "Failed to get nonce");
      }

      const rawSignature = await signMessageAsync({
        message: nonceData.messageToSign,
      });

      // Build debug info (only included when DEBUG_SIGN is enabled)
      const debugEnabled =
        typeof window !== "undefined" &&
        (window as unknown as Record<string, unknown>).DEBUG_SIGN === true;

      // Cast to unknown for instanceof checks
      const rawSig: unknown = rawSignature;

      const debugInfo = debugEnabled
        ? {
            rawType: typeof rawSig,
            rawStringLen:
              typeof rawSig === "string" ? rawSig.length : null,
            rawStringPrefix:
              typeof rawSig === "string"
                ? rawSig.slice(0, 12)
                : null,
            isArrayBuffer: rawSig instanceof ArrayBuffer,
            isUint8Array: rawSig instanceof Uint8Array,
            keys:
              rawSig && typeof rawSig === "object"
                ? Object.keys(rawSig as object)
                : null,
          }
        : undefined;

      // ALWAYS send raw signature to server - server handles normalization
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          signature: rawSignature, // Send raw, unmodified
          nonce: nonceData.nonce,
          debug: debugInfo,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        const errMsg = verifyData.error || "Failed to verify signature";
        // Show errorCode in debug mode
        if (debugEnabled && verifyData.errorCode) {
          console.log("[sign-in] Server error:", verifyData.errorCode, verifyData);
        }
        // User-friendly message for signature format issues
        if (errMsg.includes("format") || errMsg.includes("length")) {
          throw new Error("Signature format not recognized. Please try again.");
        }
        throw new Error(errMsg);
      }

      setAuthToken(verifyData.token);
      setAuthAddress(verifyData.address);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          token: verifyData.token,
          address: verifyData.address,
          expiresAt: verifyData.expiresAt,
        })
      );
      showToast("Signed in");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setIsSigningIn(false);
    }
  }, [address, signMessageAsync, showToast]);

  const startGame = useCallback(() => {
    if (!isAudioInitialized()) {
      initAudio();
    }
    tryStartBgm();

    const newRunId = generateRunId();
    setRunId(newRunId);
    setGameState(createInitialState());
    setFreeHintsUsed(0);
    setPurchasedHintsRemaining(0);
    setHintCooldownEnd(0);
    clearHint();
    setView("game");
    setGameStartAt(Date.now());
    setAnimationPhase("idle");
    setSwapPair(null);
    setMovements([]);
    setPendingSwap(null);
    setHintPurchaseState("idle");
    setPurchaseIntent(null);
    setPurchaseTxHash(null);
    setPurchaseError(null);
    resetTx();
  }, [clearHint, resetTx]);

  const handleRestart = useCallback(() => {
    const newRunId = generateRunId();
    setRunId(newRunId);
    setGameState(createInitialState());
    setFreeHintsUsed(0);
    setPurchasedHintsRemaining(0);
    setHintCooldownEnd(0);
    clearHint();
    setToast(null);
    setFloatingScores([]);
    setGameStartAt(Date.now());
    setAnimationPhase("idle");
    setSwapPair(null);
    setMovements([]);
    setPendingSwap(null);
    setHintPurchaseState("idle");
    setPurchaseIntent(null);
    setPurchaseTxHash(null);
    setPurchaseError(null);
    resetTx();
  }, [clearHint, resetTx]);

  const handleHint = useCallback(() => {
    if (!gameState || animationPhase !== "idle" || gameState.moves <= 0) return;

    if (remainingHints <= 0) {
      // No hints - should trigger buy flow instead
      return;
    }

    const now = Date.now();
    if (now < hintCooldownEnd) {
      const secsLeft = Math.ceil((hintCooldownEnd - now) / 1000);
      showToast(`Hint cooldown: ${secsLeft}s`);
      return;
    }

    const hint = findHintMove(gameState.board);
    if (!hint) {
      showToast("No hint available");
      return;
    }

    clearHint();
    setHintCells([hint.from, hint.to]);

    // Consume hint: prefer free hints first, then purchased
    if (freeHintsUsed < FREE_HINTS_PER_RUN) {
      setFreeHintsUsed((prev) => prev + 1);
    } else if (purchasedHintsRemaining > 0) {
      setPurchasedHintsRemaining((prev) => prev - 1);
    }

    setHintCooldownEnd(Date.now() + HINT_COOLDOWN_MS);

    hintTimeoutRef.current = setTimeout(() => {
      setHintCells([]);
    }, HINT_DISPLAY_MS);
  }, [
    gameState,
    animationPhase,
    remainingHints,
    freeHintsUsed,
    purchasedHintsRemaining,
    hintCooldownEnd,
    clearHint,
    showToast,
  ]);

  const handleBuyHints = useCallback(async () => {
    // Don't start new purchase if one is in progress (except error state which allows retry)
    if (
      hintPurchaseState !== "idle" &&
      hintPurchaseState !== "error" &&
      hintPurchaseState !== "success"
    ) {
      return;
    }

    if (!isConnected) {
      handleConnect();
      return;
    }

    if (!isOnBase) {
      try {
        await switchChain({ chainId: base.id });
      } catch {
        showToast("Please switch to Base network");
      }
      return;
    }

    if (!authToken) {
      showToast("Please sign in first");
      handleSignIn();
      return;
    }

    try {
      // Reset any previous purchase state before starting new one
      resetTx();
      setPurchaseIntent(null);
      setPurchaseTxHash(null);
      setHintPurchaseState("creating_intent");
      setPurchaseError(null);

      // Create intent
      const res = await fetch("/api/hints/create-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ runId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create intent");
      }

      setPurchaseIntent({
        intentToken: data.intentToken,
        requiredWei: data.requiredWei,
        treasuryAddress: data.treasuryAddress,
      });

      setHintPurchaseState("awaiting_signature");

      // Send transaction
      sendTransaction({
        to: data.treasuryAddress as `0x${string}`,
        value: BigInt(data.requiredWei),
        chainId: base.id,
      });
    } catch (error) {
      setPurchaseError((error as Error).message);
      setHintPurchaseState("error");
    }
  }, [
    isConnected,
    isOnBase,
    authToken,
    runId,
    handleConnect,
    handleSignIn,
    hintPurchaseState,
    switchChain,
    sendTransaction,
    resetTx,
    showToast,
  ]);

  const verifyHintPurchase = useCallback(
    async (hash: string, retryCount = 0) => {
      if (!purchaseIntent || !address || !authToken) return;

      const MAX_RETRIES = 10;
      const RETRY_DELAYS = [1000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];

      try {
        setHintPurchaseState("verifying");

        const res = await fetch("/api/hints/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            intentToken: purchaseIntent.intentToken,
            txHash: hash,
            address,
          }),
        });

        const data = await res.json();

        // Handle 202 pending (not enough confirmations)
        if (res.status === 202 && data.status === "pending") {
          if (retryCount < MAX_RETRIES) {
            setHintPurchaseState("pending");
            const delay = RETRY_DELAYS[retryCount] || 5000;
            setTimeout(() => {
              verifyHintPurchase(hash, retryCount + 1);
            }, delay);
            return;
          } else {
            setPurchaseError("Transaction still pending. Click to retry.");
            setHintPurchaseState("error");
            return;
          }
        }

        // Handle 400 error
        if (!res.ok) {
          throw new Error(data.error || "Verification failed");
        }

        // Success - check if already processed (retry hit)
        if (data.alreadyProcessed) {
          // Already verified in a previous retry - just show success
          setHintPurchaseState("success");
          showToast("Payment verified!");
        } else {
          // New verification - add hints
          setPurchasedHintsRemaining((prev) => prev + HINTS_PACK_SIZE);
          setHintPurchaseState("success");
          showToast(`+${HINTS_PACK_SIZE} hints added!`);
        }

        // Fully reset purchase state after short delay
        setTimeout(() => {
          setHintPurchaseState("idle");
          setPurchaseIntent(null);
          setPurchaseTxHash(null);
          setPurchaseError(null);
          resetTx();
        }, 2000);
      } catch (error) {
        setPurchaseError((error as Error).message);
        setHintPurchaseState("error");
      }
    },
    [purchaseIntent, address, authToken, showToast, resetTx]
  );

  // Update purchase state when tx hash is received
  useEffect(() => {
    if (txHash && hintPurchaseState === "awaiting_signature") {
      setPurchaseTxHash(txHash);
      setHintPurchaseState("pending");
    }
  }, [txHash, hintPurchaseState]);

  const handleCellClick = useCallback(
    (coord: Coord) => {
      if (!gameState || gameState.moves <= 0 || animationPhase !== "idle")
        return;

      if (!isAudioInitialized()) {
        initAudio();
        tryStartBgm();
      }

      clearHint();

      if (gameState.selected === null) {
        setGameState({ ...gameState, selected: coord });
      } else if (
        gameState.selected.row === coord.row &&
        gameState.selected.col === coord.col
      ) {
        setGameState({ ...gameState, selected: null });
      } else if (!areAdjacent(gameState.selected, coord)) {
        setGameState({ ...gameState, selected: coord });
      } else {
        const from = gameState.selected;
        const to = coord;

        const result = applySwap(gameState, from, to);
        const isValid = result.steps.length > 0;

        setPendingSwap({
          from,
          to,
          originalState: gameState,
          nextState: result.nextState,
          steps: result.steps,
          didReshuffle: result.didReshuffle,
          isValid,
        });

        setSwapPair({ from, to });
        setAnimationPhase("swapping");
        playSwap();
      }
    },
    [gameState, animationPhase, clearHint]
  );

  // Handle swipe-to-swap from grid
  const handleSwap = useCallback(
    (from: Coord, to: Coord) => {
      if (!gameState || gameState.moves <= 0 || animationPhase !== "idle") return;

      if (!isAudioInitialized()) {
        initAudio();
        tryStartBgm();
      }

      clearHint();

      const result = applySwap(gameState, from, to);
      const isValid = result.steps.length > 0;

      setPendingSwap({
        from,
        to,
        originalState: gameState,
        nextState: result.nextState,
        steps: result.steps,
        didReshuffle: result.didReshuffle,
        isValid,
      });

      setSwapPair({ from, to });
      setAnimationPhase("swapping");
      playSwap();
    },
    [gameState, animationPhase, clearHint]
  );

  const handleAnimationComplete = useCallback(() => {
    if (animationPhase === "swapping" && pendingSwap) {
      if (pendingSwap.isValid) {
        const totalPoints = pendingSwap.steps.reduce(
          (sum, s) => sum + s.pointsAdded,
          0
        );
        if (totalPoints > 0) {
          showFloatingScore(totalPoints);
        }

        if (pendingSwap.steps.length === 1) {
          playMatch();
        } else if (pendingSwap.steps.length > 1) {
          playCascade();
          // Trigger combo overlay
          setComboMultiplier(pendingSwap.steps.length);
        }

        const allMovements: TileMovement[] = [];
        for (const step of pendingSwap.steps) {
          allMovements.push(...step.movements);
        }

        setGameState(pendingSwap.nextState);
        setSwapPair(null);
        setMovements(allMovements);
        setAnimationPhase("dropping");

        if (pendingSwap.didReshuffle) {
          showToast("No moves — reshuffled");
        }

        if (pendingSwap.nextState.moves <= 0) {
          setTimeout(() => playGameOver(), 400);
        }
      } else {
        setAnimationPhase("swap_back");
      }
    } else if (animationPhase === "swap_back" && pendingSwap) {
      setGameState({ ...pendingSwap.originalState, selected: null });
      setSwapPair(null);
      setPendingSwap(null);
      setAnimationPhase("idle");
    } else if (animationPhase === "dropping") {
      setMovements([]);
      setPendingSwap(null);
      setAnimationPhase("idle");
    } else {
      setAnimationPhase("idle");
      setSwapPair(null);
      setMovements([]);
      setPendingSwap(null);
    }
  }, [animationPhase, pendingSwap, showFloatingScore, showToast]);

  const loadLeaderboard = useCallback(async () => {
    try {
      setLeaderboardLoading(true);
      const res = await fetch(
        `/api/leaderboard?mode=${leaderboardMode}&limit=50`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load leaderboard");
      }
      setLeaderboardResults(data.results || []);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [leaderboardMode, showToast]);

  useEffect(() => {
    if (view === "leaderboard") {
      loadLeaderboard();
    }
  }, [view, leaderboardMode, loadLeaderboard]);

  // Resolve ENS names
  useEffect(() => {
    if (view !== "leaderboard" || leaderboardResults.length === 0) return;

    const resolveEns = async () => {
      const newNames = new Map(ensNames);
      let updated = false;

      for (const entry of leaderboardResults) {
        const addr = entry.address.toLowerCase();
        if (newNames.has(addr)) continue;

        try {
          const name = await ensClient.getEnsName({
            address: entry.address as `0x${string}`,
          });
          newNames.set(addr, name);
          updated = true;
        } catch {
          newNames.set(addr, null);
          updated = true;
        }
      }

      if (updated) {
        setEnsNames(newNames);
      }
    };

    resolveEns();
  }, [view, leaderboardResults, ensNames]);

  const handleSubmitScore = useCallback(async () => {
    if (!gameState || !authToken || !authAddress) return;
    if (!gameStartAt) {
      showToast("Missing game start time");
      return;
    }
    try {
      setIsSubmitting(true);
      const durationMs = Math.max(0, Date.now() - gameStartAt);
      const totalHintsUsed = freeHintsUsed + (HINTS_PACK_SIZE - purchasedHintsRemaining);
      const res = await fetch("/api/score/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          score: gameState.score,
          durationMs,
          movesUsed: INITIAL_MOVES - gameState.moves,
          hintsUsed: totalHintsUsed,
          gameVersion: "v1",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit score");
      }
      showToast("Score submitted!");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    gameState,
    authToken,
    authAddress,
    gameStartAt,
    freeHintsUsed,
    purchasedHintsRemaining,
    showToast,
  ]);

  const isAuthedForWallet =
    !!authToken &&
    !!authAddress &&
    !!address &&
    authAddress.toLowerCase() === address.toLowerCase();

  const isAnimating = animationPhase !== "idle";

  const hintButtonDisabled =
    isAnimating ||
    !gameState ||
    gameState.moves <= 0 ||
    hintPurchaseState !== "idle";

  const getDisplayName = (addr: string) => {
    const ens = ensNames.get(addr.toLowerCase());
    return ens || shortAddress(addr);
  };

  const getConnectButtonText = () => {
    if (isConnecting) return "Connecting…";
    if (isConnected) return shortAddress(address);
    return "Connect Wallet";
  };

  const getHintButtonContent = () => {
    if (hintPurchaseState === "creating_intent") return "Preparing…";
    if (hintPurchaseState === "awaiting_signature") return "Sign transaction…";
    if (hintPurchaseState === "pending" || isTxConfirming) return "Confirming…";
    if (hintPurchaseState === "verifying") return "Verifying…";
    if (hintPurchaseState === "success") return "✓ Hints added!";
    if (hintPurchaseState === "error") return "Retry purchase";

    if (remainingHints > 0) {
      return `Hint (${remainingHints})`;
    }

    // Show buy option
    if (!isConnected) return "Connect to buy hints";
    if (!isOnBase) return "Switch to Base";
    if (!isAuthedForWallet) return "Sign in to buy";

    // Show price only if we have a valid intent
    if (purchaseIntent?.requiredWei) {
      try {
        const priceEth = formatEther(BigInt(purchaseIntent.requiredWei));
        const formatted = Number(priceEth).toFixed(5);
        if (!isNaN(Number(formatted))) {
          return `Buy 3 hints (~${formatted} ETH)`;
        }
      } catch {
        // Fall through to default
      }
    }
    return "Buy 3 hints ($1)";
  };

  const handleHintButtonClick = () => {
    if (remainingHints > 0 && hintPurchaseState === "idle") {
      handleHint();
    } else {
      handleBuyHints();
    }
  };

  return (
    <div className={`min-h-screen bg-[#0b1020] text-[#e6f0ff] ${view === "game" ? "scroll-lock" : ""}`}>
      {/* Welcome modal (once per day) */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-10 pt-6 safe-area-padding">
        <div className="flex items-center justify-between">
          <BaseHeader />
          {view === "game" && <AudioControls />}
        </div>
        {view === "home" ? (
          <main className="mt-10 flex flex-1 flex-col gap-6">
            <div className="rounded-2xl border border-white/10 bg-[#111a33] p-5 shadow-[0_0_40px_rgba(0,82,255,0.18)]">
              <h2 className="text-xl font-semibold text-white">
                Ready to crash?
              </h2>
              <p className="mt-2 text-sm text-[#9cc1ff]">
                Match, combo, and climb the Base Crash leaderboard.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                className={`h-12 w-full rounded-full border text-sm font-semibold transition-colors ${
                  isConnected
                    ? "border-[#0052ff]/50 bg-[#0052ff]/20 text-white"
                    : "border-white/20 bg-white/5 text-white"
                }`}
                type="button"
                onClick={handleConnect}
                disabled={isConnecting}
              >
                {getConnectButtonText()}
              </button>
              {isConnected && (
                <div className="flex gap-3">
                  {!isAuthedForWallet ? (
                    <button
                      className="h-11 flex-1 rounded-full border border-[#0052ff]/50 bg-[#0052ff]/20 text-sm font-semibold text-[#6fa8ff]"
                      type="button"
                      onClick={handleSignIn}
                      disabled={isSigningIn}
                    >
                      {isSigningIn ? "Signing..." : "Sign in"}
                    </button>
                  ) : (
                    <button
                      className="h-11 flex-1 rounded-full border border-white/20 bg-white/5 text-sm font-semibold text-white"
                      type="button"
                      onClick={() => {
                        disconnect();
                        clearAuth();
                      }}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              )}
              <button
                className="h-12 w-full rounded-full bg-[#0052ff] text-sm font-semibold text-white shadow-[0_10px_25px_rgba(0,82,255,0.35)]"
                type="button"
                onClick={startGame}
              >
                Play
              </button>
              <button
                className="h-12 w-full rounded-full border border-white/20 bg-white/5 text-sm font-semibold text-white"
                type="button"
                onClick={() => setView("leaderboard")}
              >
                Leaderboard
              </button>
              <button
                className="h-12 w-full rounded-full border border-[#ff6b00]/50 bg-[#ff6b00]/20 text-sm font-semibold text-[#ffb366]"
                type="button"
                onClick={() => setView("gm")}
              >
                GM Streak ☀️
              </button>
            </div>
            <div className="mt-auto rounded-2xl border border-white/10 bg-[#0f1730] px-4 py-3 text-xs text-[#8aa8ff]">
              Base Mini App preview. Wallet connect enables leaderboard access.
            </div>
          </main>
        ) : view === "leaderboard" ? (
          <main className="mt-6 flex flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Leaderboard</h2>
              <button
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white"
                type="button"
                onClick={() => setView("home")}
              >
                Back
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                  leaderboardMode === "daily"
                    ? "border-[#0052ff] bg-[#0052ff]/20 text-white"
                    : "border-white/20 bg-white/5 text-white/70"
                }`}
                type="button"
                onClick={() => setLeaderboardMode("daily")}
              >
                Daily
              </button>
              <button
                className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                  leaderboardMode === "alltime"
                    ? "border-[#0052ff] bg-[#0052ff]/20 text-white"
                    : "border-white/20 bg-white/5 text-white/70"
                }`}
                type="button"
                onClick={() => setLeaderboardMode("alltime")}
              >
                All-time
              </button>
            </div>
            {!isAuthedForWallet && (
              <div className="rounded-2xl border border-white/10 bg-[#111a33] p-4 text-sm text-[#9cc1ff]">
                Connect + Sign in to submit scores.
              </div>
            )}
            <div className="rounded-2xl border border-white/10 bg-[#0f1730] p-4">
              {leaderboardLoading ? (
                <p className="text-sm text-white/70">Loading...</p>
              ) : leaderboardResults.length === 0 ? (
                <p className="text-sm text-white/70">No scores yet.</p>
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  {leaderboardResults.map((entry) => {
                    const isMe =
                      address &&
                      entry.address.toLowerCase() === address.toLowerCase();
                    return (
                      <div
                        key={`${entry.rank}-${entry.address}`}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                          isMe ? "bg-[#0052ff]/20 text-white" : "bg-white/5"
                        }`}
                      >
                        <span className="text-xs text-white/70">
                          #{entry.rank}
                        </span>
                        <span className="flex-1 pl-3 text-white truncate">
                          {getDisplayName(entry.address)}
                        </span>
                        <span className="text-white font-semibold">
                          {entry.score}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        ) : view === "gm" ? (
          <GMStreakView authToken={authToken} onBack={() => setView("home")} />
        ) : gameState ? (
          <main className="mt-6 flex flex-1 flex-col gap-5">
            <GameHUD
              score={gameState.score}
              moves={gameState.moves}
              hints={remainingHints}
            />

            {/* Grid wrapper for floating scores */}
            <div className="relative">
              <TokenGridPlaceholder
                board={gameState.board}
                selected={gameState.selected}
                hintCells={hintCells}
                disabled={isAnimating || gameState.moves <= 0}
                animationPhase={animationPhase}
                swapPair={swapPair}
                movements={movements}
                onCellClick={handleCellClick}
                onSwap={handleSwap}
                onAnimationComplete={handleAnimationComplete}
              />

              {/* Combo overlay */}
              {comboMultiplier >= 2 && (
                <ComboOverlay
                  multiplier={comboMultiplier}
                  onComplete={() => setComboMultiplier(0)}
                />
              )}

              {/* Floating score indicators */}
              {floatingScores.map((fs) => (
                <div
                  key={fs.id}
                  className="float-score pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold text-[#0052ff] drop-shadow-[0_0_8px_rgba(0,82,255,0.8)]"
                >
                  +{fs.points}
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                className={`h-12 flex-1 rounded-full border text-sm font-semibold transition-all ${
                  hintButtonDisabled && remainingHints > 0
                    ? "border-white/20 bg-white/5 text-white/60"
                    : remainingHints > 0
                    ? "border-[#0052ff]/50 bg-[#0052ff]/20 text-[#6fa8ff] hover:bg-[#0052ff]/30"
                    : "border-[#ff6b00]/50 bg-[#ff6b00]/20 text-[#ffb366] hover:bg-[#ff6b00]/30"
                }`}
                disabled={hintButtonDisabled && remainingHints > 0}
                type="button"
                onClick={handleHintButtonClick}
              >
                {getHintButtonContent()}
              </button>
              <button
                className="h-12 flex-1 rounded-full bg-white text-sm font-semibold text-[#0b1020]"
                type="button"
                onClick={handleRestart}
              >
                Restart
              </button>
            </div>

            {/* Purchase error */}
            {purchaseError && hintPurchaseState === "error" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {purchaseError}
              </div>
            )}

            {/* Toast */}
            {toast && (
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-[#111a33] border border-white/20 px-4 py-2 text-sm text-white shadow-lg z-50">
                {toast}
              </div>
            )}

            {gameState.moves <= 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#111a33] p-4 text-center">
                <p className="text-lg font-semibold text-white">Game Over!</p>
                <p className="mt-1 text-sm text-[#9cc1ff]">
                  Final Score: {gameState.score}
                </p>
                <div className="mt-4">
                  {!isConnected ? (
                    <button
                      className="h-11 w-full rounded-full border border-white/20 bg-white/5 text-sm font-semibold text-white"
                      type="button"
                      onClick={handleConnect}
                      disabled={isConnecting}
                    >
                      {isConnecting
                        ? "Connecting…"
                        : "Connect wallet to submit"}
                    </button>
                  ) : !isAuthedForWallet ? (
                    <button
                      className="h-11 w-full rounded-full border border-[#0052ff]/50 bg-[#0052ff]/20 text-sm font-semibold text-[#6fa8ff]"
                      type="button"
                      onClick={handleSignIn}
                      disabled={isSigningIn}
                    >
                      {isSigningIn ? "Signing..." : "Sign in to submit"}
                    </button>
                  ) : (
                    <button
                      className="h-11 w-full rounded-full bg-[#0052ff] text-sm font-semibold text-white"
                      type="button"
                      onClick={handleSubmitScore}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "Submitting..." : "Submit score"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </main>
        ) : null}
      </div>
    </div>
  );
}
