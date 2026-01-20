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
import { formatWalletError, isUserCancellation } from "@/lib/errors";

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
  const [authFid, setAuthFid] = useState<string | null>(null); // Farcaster ID (Quick Auth)
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState(false);

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
    setAuthFid(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  useEffect(() => {
    sdk.actions.ready();
    // Detect if running inside mini app
    const detectMiniApp = async () => {
      try {
        if (typeof sdk.isInMiniApp === "function") {
          const result = await sdk.isInMiniApp();
          setIsMiniApp(result);
        } else {
          // Fallback detection based on user agent or context
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          const inFrame = window !== window.top;
          setIsMiniApp(isMobile && inFrame);
        }
      } catch {
        // Fallback if sdk.isInMiniApp fails
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const inFrame = window !== window.top;
        setIsMiniApp(isMobile && inFrame);
      }
    };
    detectMiniApp();
  }, []);

  // Load auth token from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        token: string;
        address?: string;
        fid?: string;
        expiresAt: number;
      };
      if (parsed.expiresAt < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
      setAuthToken(parsed.token);
      if (parsed.address) {
        setAuthAddress(parsed.address);
      }
      if (parsed.fid) {
        setAuthFid(parsed.fid);
      }
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

  // Handle tx error with friendly messages
  useEffect(() => {
    if (txError && hintPurchaseState === "awaiting_signature") {
      const friendlyMessage = formatWalletError(txError);
      setPurchaseError(friendlyMessage);
      setHintPurchaseState("error");
      // Toast shown via purchaseError UI - no need for separate toast
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

  // Quick Auth for mini apps (Farcaster)
  const handleQuickAuth = useCallback(async () => {
    try {
      setIsSigningIn(true);
      console.log("[quick-auth] Starting Quick Auth...");

      // Use Farcaster Quick Auth
      const quickAuth = (sdk as unknown as { quickAuth?: { getToken: () => Promise<{ token: string }> } }).quickAuth;
      if (!quickAuth?.getToken) {
        throw new Error("Quick Auth not available");
      }

      const { token } = await quickAuth.getToken();
      console.log("[quick-auth] Got token, verifying...");

      const verifyRes = await fetch("/api/auth/quick-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const verifyData = await verifyRes.json();
      console.log("[quick-auth] Server response:", JSON.stringify(verifyData));

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || "Quick Auth failed");
      }

      setAuthToken(verifyData.appToken);
      setAuthFid(verifyData.fid);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          token: verifyData.appToken,
          fid: verifyData.fid,
          expiresAt: verifyData.expiresAt,
        })
      );
      showToast("Signed in (Farcaster)");
    } catch (error) {
      console.log("[quick-auth] Error:", (error as Error).message);
      showToast((error as Error).message);
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

  // Wallet-based sign in (for desktop/non-mini-app)
  const handleWalletSignIn = useCallback(async () => {
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

      // Cast to unknown for instanceof checks
      const rawSig: unknown = rawSignature;

      // ALWAYS log signature info for debugging
      const sigInfo = {
        rawType: typeof rawSig,
        rawStringLen: typeof rawSig === "string" ? rawSig.length : null,
        rawStringPrefix: typeof rawSig === "string" ? rawSig.slice(0, 16) : null,
        rawStringSuffix: typeof rawSig === "string" ? rawSig.slice(-8) : null,
        isArrayBuffer: rawSig instanceof ArrayBuffer,
        isUint8Array: rawSig instanceof Uint8Array,
        keys: rawSig && typeof rawSig === "object" ? Object.keys(rawSig as object) : null,
      };
      console.log("[sign-in] Signature info:", JSON.stringify(sigInfo));

      // ALWAYS send raw signature to server - server handles normalization
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          signature: rawSignature, // Send raw, unmodified
          nonce: nonceData.nonce,
          debug: sigInfo,
        }),
      });
      const verifyData = await verifyRes.json();
      console.log("[sign-in] Server response:", JSON.stringify(verifyData));
      if (!verifyRes.ok) {
        const errMsg = verifyData.error || "Failed to verify signature";
        console.log("[sign-in] Server error:", verifyData.errorCode, verifyData);
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

  // Main sign-in handler - chooses Quick Auth or wallet based on context
  const handleSignIn = useCallback(async () => {
    if (isMiniApp) {
      // In mini app: use Quick Auth
      await handleQuickAuth();
    } else {
      // Desktop/browser: use wallet sign-in
      await handleWalletSignIn();
    }
  }, [isMiniApp, handleQuickAuth, handleWalletSignIn]);

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

    // Wallet must be connected for on-chain purchase
    if (!isConnected || !address) {
      showToast("Connect your wallet to buy hints");
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

    // NO auth token required for hint purchases
    // Server verifies ownership via on-chain tx.from matching the address

    try {
      // Reset any previous purchase state before starting new one
      resetTx();
      setPurchaseIntent(null);
      setPurchaseTxHash(null);
      setHintPurchaseState("creating_intent");
      setPurchaseError(null);

      // Create intent - pass address directly, no auth token needed
      const res = await fetch("/api/hints/create-intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId, address }),
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
      const friendlyMessage = formatWalletError(error);
      setPurchaseError(friendlyMessage);
      setHintPurchaseState("error");
    }
  }, [
    isConnected,
    isOnBase,
    address,
    runId,
    handleConnect,
    hintPurchaseState,
    switchChain,
    sendTransaction,
    resetTx,
    showToast,
  ]);

  const verifyHintPurchase = useCallback(
    async (hash: string, retryCount = 0) => {
      // No auth token required - server verifies via intent token + on-chain tx.from
      // Address is optional - server uses tx.from as authoritative (smart wallet support)
      if (!purchaseIntent) return;

      const MAX_RETRIES = 10;
      const RETRY_DELAYS = [1000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];

      try {
        setHintPurchaseState("verifying");

        const res = await fetch("/api/hints/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            intentToken: purchaseIntent.intentToken,
            txHash: hash,
            // address is optional - server uses on-chain tx.from as authoritative
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
        const friendlyMessage = formatWalletError(error);
        setPurchaseError(friendlyMessage);
        setHintPurchaseState("error");
      }
    },
    [purchaseIntent, showToast, resetTx]
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

  // User is authenticated via wallet signature
  const isAuthedForWallet =
    !!authToken &&
    !!authAddress &&
    !!address &&
    authAddress.toLowerCase() === address.toLowerCase();

  // User is authenticated via Farcaster Quick Auth
  const isAuthedViaFarcaster = !!authToken && !!authFid;

  // User is authenticated (either method)
  const isAuthed = isAuthedForWallet || isAuthedViaFarcaster;

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
    // In-progress states
    if (hintPurchaseState === "creating_intent") return "Preparing…";
    if (hintPurchaseState === "awaiting_signature") return "Sign transaction…";
    if (hintPurchaseState === "pending" || isTxConfirming) return "Confirming…";
    if (hintPurchaseState === "verifying") return "Verifying…";
    if (hintPurchaseState === "success") return "✓ Hints added!";
    
    // Only show "Retry" if there was an actual purchase error (not pre-requisite failure)
    if (hintPurchaseState === "error" && purchaseError) {
      return "Retry purchase";
    }

    // Has hints available
    if (remainingHints > 0) {
      return `Hint (${remainingHints})`;
    }

    // Need to buy hints - only wallet + Base chain required
    // NO auth/sign-in required for on-chain purchases

    // Step 1: Wallet connection (required for on-chain tx)
    if (!isConnected) {
      return "Connect wallet to buy";
    }

    // Step 2: Correct chain
    if (!isOnBase) {
      return "Switch to Base";
    }

    // Ready to buy - show price
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
    // Use hint if available
    if (remainingHints > 0 && hintPurchaseState === "idle") {
      handleHint();
      return;
    }

    // Purchase flow - only wallet + Base chain required
    // NO auth required for on-chain purchases

    // Step 1: Wallet connection (required for on-chain tx)
    if (!isConnected) {
      handleConnect();
      return;
    }

    // Step 2: Correct chain
    if (!isOnBase) {
      switchChain({ chainId: base.id });
      return;
    }

    // Ready to buy
    handleBuyHints();
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
              {/* Mini App: Show Farcaster sign-in button */}
              {isMiniApp && !isAuthed && (
                <button
                  className="h-12 w-full rounded-full bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_10px_25px_rgba(139,92,246,0.35)]"
                  type="button"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                >
                  {isSigningIn ? "Signing in..." : "Sign in (Farcaster)"}
                </button>
              )}
              {/* Mini App: Show signed in status */}
              {isMiniApp && isAuthed && (
                <div className="flex items-center justify-between rounded-full border border-[#8b5cf6]/50 bg-[#8b5cf6]/20 px-4 py-3">
                  <span className="text-sm text-white">
                    ✓ Signed in {authFid ? `(FID ${authFid})` : ""}
                  </span>
                  <button
                    className="text-xs text-[#8b5cf6] hover:text-white"
                    type="button"
                    onClick={clearAuth}
                  >
                    Sign out
                  </button>
                </div>
              )}
              {/* Wallet connect button */}
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
              {/* Desktop/browser: wallet-based sign in */}
              {!isMiniApp && isConnected && (
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

            {/* Purchase error - styled based on error type */}
            {purchaseError && hintPurchaseState === "error" && (() => {
              const isFriendly = purchaseError.toLowerCase().includes("wallet") ||
                purchaseError.toLowerCase().includes("connect") ||
                purchaseError.toLowerCase().includes("sign in");
              return (
                <div className={`rounded-xl px-4 py-2 text-sm ${
                  isFriendly
                    ? "border border-[#0052ff]/30 bg-[#0052ff]/10 text-[#6fa8ff]"
                    : "border border-red-500/30 bg-red-500/10 text-red-300"
                }`}>
                  {purchaseError}
                </div>
              );
            })()}

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
                  {!isAuthed ? (
                    <button
                      className="h-11 w-full rounded-full border border-[#0052ff]/50 bg-[#0052ff]/20 text-sm font-semibold text-[#6fa8ff]"
                      type="button"
                      onClick={handleSignIn}
                      disabled={isSigningIn}
                    >
                      {isSigningIn
                        ? "Signing in…"
                        : isMiniApp
                        ? "Sign in (Farcaster) to submit"
                        : "Sign in to submit"}
                    </button>
                  ) : !isConnected ? (
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
                  ) : !isAuthedForWallet && !isMiniApp ? (
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

        {/* Auth Debug Section (only when DEBUG_SIGN=true on window) */}
        {typeof window !== "undefined" &&
          (window as unknown as Record<string, unknown>).DEBUG_SIGN === true && (
          <div className="fixed bottom-2 left-2 z-50 rounded-lg bg-black/80 p-2 text-xs text-white font-mono">
            <div>isMiniApp: {String(isMiniApp)}</div>
            <div>isAuthed: {String(isAuthed)}</div>
            <div>authFid: {authFid || "null"}</div>
            <div>token: {authToken ? "yes" : "no"}</div>
            <div>wallet: {isConnected ? shortAddress(address) : "no"}</div>
            <div>hintState: {hintPurchaseState}</div>
          </div>
        )}
      </div>
    </div>
  );
}
