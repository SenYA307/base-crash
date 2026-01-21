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
import { createPublicClient, http, encodeFunctionData } from "viem";
import { mainnet, base } from "wagmi/chains";

import { BottomNav, type TabId } from "@/components/BottomNav";
import { AccountView } from "@/components/views/AccountView";
import { LeaderboardView } from "@/components/views/LeaderboardView";
import GameHUD from "@/components/GameHUD";
import TokenGridPlaceholder, {
  type AnimationPhase,
  type SwapPair,
} from "@/components/TokenGridPlaceholder";
import ComboOverlay from "@/components/ComboOverlay";
import GMStreakView from "@/components/GMStreakView";
import WelcomeModal from "@/components/WelcomeModal";
import {
  createInitialState,
  applySwap,
  findHintMove,
  areAdjacent,
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
  // Tab navigation
  const [activeTab, setActiveTab] = useState<TabId>("game");
  
  // Game state
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
    requiredUsdc: string;
    tokenAddress: string;
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
  const [authFid, setAuthFid] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMiniApp, setIsMiniApp] = useState(false);

  // Leaderboard state
  const [leaderboardMode, setLeaderboardMode] =
    useState<"daily" | "weekly" | "alltime">("weekly");
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
  const isAuthed = !!authToken && (!!authAddress || !!authFid);
  const isAuthedForWallet =
    !!authAddress && !!address && authAddress.toLowerCase() === address.toLowerCase();
  const isAnimating = animationPhase !== "idle";
  const isGameOver = !!(gameState && gameState.moves <= 0);
  const isGameActive = !!(gameState && gameState.moves > 0);

  // ===============================
  // Auth & Wallet handlers
  // ===============================

  const clearAuth = useCallback(() => {
    setAuthToken(null);
    setAuthAddress(null);
    setAuthFid(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const showToast = useCallback((message: string, durationMs = 2000) => {
    setToast(message);
    setTimeout(() => setToast(null), durationMs);
  }, []);

  useEffect(() => {
    sdk.actions.ready();
    const detectMiniApp = async () => {
      try {
        if (typeof sdk.isInMiniApp === "function") {
          const result = await sdk.isInMiniApp();
          setIsMiniApp(result);
        } else {
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          const inFrame = window !== window.top;
          setIsMiniApp(isMobile && inFrame);
        }
      } catch {
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
      if (parsed.address) setAuthAddress(parsed.address);
      if (parsed.fid) setAuthFid(parsed.fid);
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
      const quickAuth = (sdk as unknown as { quickAuth?: { getToken: () => Promise<{ token: string }> } }).quickAuth;
      if (!quickAuth?.getToken) {
        throw new Error("Quick Auth not available");
      }
      const { token } = await quickAuth.getToken();
      const verifyRes = await fetch("/api/auth/quick-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const verifyData = await verifyRes.json();
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
      showToast((error as Error).message);
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

  // Wallet-based sign in
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
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          signature: rawSignature,
          nonce: nonceData.nonce,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || "Failed to verify signature");
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

  const handleSignIn = useCallback(async () => {
    if (isMiniApp) {
      await handleQuickAuth();
    } else {
      await handleWalletSignIn();
    }
  }, [isMiniApp, handleQuickAuth, handleWalletSignIn]);

  const handleSwitchToBase = useCallback(async () => {
    try {
      await switchChain({ chainId: base.id });
    } catch {
      showToast("Please switch to Base network");
    }
  }, [switchChain, showToast]);

  // ===============================
  // Game Logic
  // ===============================

  const clearHint = useCallback(() => {
    setHintCells([]);
    if (hintTimeoutRef.current) {
      clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    };
  }, []);

  const showFloatingScore = useCallback((points: number) => {
    const id = floatingIdRef.current++;
    setFloatingScores((prev) => [...prev, { id, points }]);
    setTimeout(() => {
      setFloatingScores((prev) => prev.filter((f) => f.id !== id));
    }, 1100);
  }, []);

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
    setActiveTab("game");
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

  // Cell click handler
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

  // Swipe handler
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

  // Animation complete handler
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

  // ===============================
  // Hints
  // ===============================

  const handleHint = useCallback(() => {
    if (
      !gameState ||
      animationPhase !== "idle" ||
      hintCells.length > 0 ||
      Date.now() < hintCooldownEnd ||
      remainingHints <= 0
    )
      return;

    const hint = findHintMove(gameState.board);
    if (hint) {
      setHintCells([hint.from, hint.to]);
      hintTimeoutRef.current = setTimeout(() => {
        setHintCells([]);
      }, HINT_DISPLAY_MS);

      if (freeHintsUsed < FREE_HINTS_PER_RUN) {
        setFreeHintsUsed((prev) => prev + 1);
      } else if (purchasedHintsRemaining > 0) {
        setPurchasedHintsRemaining((prev) => prev - 1);
      }

      setHintCooldownEnd(Date.now() + HINT_COOLDOWN_MS);
    } else {
      showToast("No hints available");
    }
  }, [
    gameState,
    animationPhase,
    hintCells.length,
    hintCooldownEnd,
    remainingHints,
    freeHintsUsed,
    purchasedHintsRemaining,
    showToast,
  ]);

  // ===============================
  // Hint Purchase
  // ===============================

  const verifyHintPurchase = useCallback(
    async (hash: string, retryCount = 0) => {
      if (!purchaseIntent) return;

      try {
        setHintPurchaseState("verifying");
        const res = await fetch("/api/hints/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intentToken: purchaseIntent.intentToken,
            txHash: hash,
          }),
        });
        const data = await res.json();

        if (res.status === 202) {
          if (retryCount < 10) {
            setTimeout(() => verifyHintPurchase(hash, retryCount + 1), 2000);
          } else {
            setPurchaseError("Verification timed out. Please try again.");
            setHintPurchaseState("error");
          }
          return;
        }

        if (!res.ok) {
          const errorMsg = data.error || "Verification failed";
          setPurchaseError(formatWalletError({ message: errorMsg }));
          setHintPurchaseState("error");
          return;
        }

        setPurchasedHintsRemaining((prev) => prev + (data.addedHints || HINTS_PACK_SIZE));
        setHintPurchaseState("success");
        showToast(`+${data.addedHints || HINTS_PACK_SIZE} hints added!`);
        setTimeout(() => setHintPurchaseState("idle"), 2000);
      } catch (error) {
        setPurchaseError(formatWalletError(error));
        setHintPurchaseState("error");
      }
    },
    [purchaseIntent, showToast]
  );

  useEffect(() => {
    if (
      isTxConfirmed &&
      txHash &&
      hintPurchaseState === "pending" &&
      purchaseIntent
    ) {
      verifyHintPurchase(txHash);
    }
  }, [isTxConfirmed, txHash, hintPurchaseState, purchaseIntent, verifyHintPurchase]);

  useEffect(() => {
    if (txError && hintPurchaseState === "awaiting_signature") {
      const friendlyMessage = formatWalletError(txError);
      setPurchaseError(friendlyMessage);
      setHintPurchaseState("error");
    }
  }, [txError, hintPurchaseState]);

  const handleBuyHints = useCallback(async () => {
    if (hintPurchaseState !== "idle" && hintPurchaseState !== "error") return;

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

    try {
      resetTx();
      setPurchaseIntent(null);
      setPurchaseTxHash(null);
      setHintPurchaseState("creating_intent");
      setPurchaseError(null);

      const res = await fetch("/api/hints/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, address }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create intent");
      }

      setPurchaseIntent({
        intentToken: data.intentToken,
        requiredUsdc: data.requiredUsdc,
        tokenAddress: data.tokenAddress,
        treasuryAddress: data.treasuryAddress,
      });

      setHintPurchaseState("awaiting_signature");

      // USDC transfer
      const callData = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "transfer",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "transfer",
        args: [
          data.treasuryAddress as `0x${string}`,
          BigInt(data.requiredUsdc),
        ],
      });

      sendTransaction({
        to: data.tokenAddress as `0x${string}`,
        data: callData,
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

  // Set pending state when tx hash received
  useEffect(() => {
    if (txHash && hintPurchaseState === "awaiting_signature") {
      setPurchaseTxHash(txHash);
      setHintPurchaseState("pending");
    }
  }, [txHash, hintPurchaseState]);

  const handleHintButtonClick = useCallback(() => {
    if (remainingHints > 0 && hintPurchaseState === "idle") {
      handleHint();
      return;
    }
    handleBuyHints();
  }, [remainingHints, hintPurchaseState, handleHint, handleBuyHints]);

  // ===============================
  // Leaderboard
  // ===============================

  const loadLeaderboard = useCallback(async () => {
    try {
      setLeaderboardLoading(true);
      const res = await fetch(`/api/leaderboard?mode=${leaderboardMode}&limit=50`);
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
    if (activeTab === "leaderboard") {
      loadLeaderboard();
    }
  }, [activeTab, leaderboardMode, loadLeaderboard]);

  // ENS resolution
  useEffect(() => {
    const resolveEns = async () => {
      const unresolvedAddresses = leaderboardResults
        .map((e) => e.address)
        .filter((addr) => !ensNames.has(addr));

      if (unresolvedAddresses.length === 0) return;

      const newNames = new Map(ensNames);
      for (const addr of unresolvedAddresses.slice(0, 10)) {
        try {
          const name = await ensClient.getEnsName({ address: addr as `0x${string}` });
          newNames.set(addr, name);
        } catch {
          newNames.set(addr, null);
        }
      }
      setEnsNames(newNames);
    };
    resolveEns();
  }, [leaderboardResults, ensNames]);

  const handleSubmitScore = useCallback(async () => {
    if (!gameState || !authToken) return;

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/score/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          score: gameState.score,
          runId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit score");
      }
      showToast("Score submitted!");
      setActiveTab("leaderboard");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, [gameState, authToken, runId, showToast]);

  // ===============================
  // Render Helpers
  // ===============================

  const getHintButtonContent = () => {
    if (hintPurchaseState === "creating_intent") return "Preparing...";
    if (hintPurchaseState === "awaiting_signature") return "Confirm in wallet...";
    if (hintPurchaseState === "pending") return "Processing...";
    if (hintPurchaseState === "verifying") return "Verifying...";
    if (hintPurchaseState === "success") return "Hints added! ✓";
    if (hintPurchaseState === "error") return "Try again";

    if (remainingHints > 0) {
      return `Hint (${remainingHints})`;
    }

    if (!isConnected) {
      return "Connect wallet to buy";
    }

    if (!isOnBase) {
      return "Switch to Base";
    }

    if (purchaseIntent?.requiredUsdc) {
      try {
        const priceUsdc = Number(purchaseIntent.requiredUsdc) / 1_000_000;
        return `Buy 3 hints (${priceUsdc.toFixed(0)} USDC)`;
      } catch {
        // Fall through
      }
    }
    return "Buy 3 hints (1 USDC)";
  };

  const hintButtonDisabled =
    !isGameActive ||
    animationPhase !== "idle" ||
    hintCells.length > 0 ||
    Date.now() < hintCooldownEnd;

  // ===============================
  // Render Content Based on Tab
  // ===============================

  const renderCenterContent = () => {
    if (activeTab === "gm") {
      return <GMStreakView authToken={authToken} onBack={() => setActiveTab("game")} />;
    }

    if (activeTab === "leaderboard") {
      // On mobile, show the leaderboard view
      return (
        <div className="lg:hidden p-4">
          <LeaderboardView
            mode={leaderboardMode}
            onModeChange={setLeaderboardMode}
            entries={leaderboardResults}
            loading={leaderboardLoading}
            ensNames={ensNames}
            currentAddress={address || null}
            currentScore={gameState?.score ?? null}
            isGameOver={isGameOver}
            isAuthed={isAuthed}
            isSubmitting={isSubmitting}
            onSubmitScore={handleSubmitScore}
          />
        </div>
      );
    }

    if (activeTab === "account") {
      // On mobile, show the account view
      return (
        <div className="lg:hidden p-4">
          <AccountView
            authToken={authToken}
            authAddress={authAddress}
            authFid={authFid}
            isSigningIn={isSigningIn}
            isMiniApp={isMiniApp}
            isConnected={isConnected}
            address={address}
            isOnBase={isOnBase}
            isConnecting={isConnecting}
            onConnect={handleConnect}
            onDisconnect={() => { disconnect(); clearAuth(); }}
            onSignIn={handleSignIn}
            onSignOut={clearAuth}
            onSwitchToBase={handleSwitchToBase}
          />
        </div>
      );
    }

    // Game tab (default)
    if (!gameState) {
      // Start screen
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-3">Base Crash</h1>
            <p className="text-white/60 text-sm">Match tokens, score points, climb the leaderboard</p>
          </div>

          <button
            onClick={startGame}
            className="px-10 py-4 rounded-2xl bg-[#0052ff] text-white text-lg font-bold hover:bg-[#0052ff]/90 transition-all shadow-lg shadow-[#0052ff]/30"
          >
            Start Game
          </button>
        </div>
      );
    }

    // Active game
    return (
      <div className="flex flex-col items-center p-4">
        {/* HUD */}
        <div className="w-full max-w-[400px] mb-4">
          <GameHUD
            score={gameState.score}
            moves={gameState.moves}
            hints={remainingHints}
          />
        </div>

        {/* Game Board */}
        <div className="relative w-full max-w-[400px]">
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

          {/* Floating scores */}
          {floatingScores.map((fs) => (
            <div
              key={fs.id}
              className="float-score pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold text-[#0052ff] drop-shadow-[0_0_8px_rgba(0,82,255,0.8)]"
            >
              +{fs.points}
            </div>
          ))}
        </div>

        {/* Payment info when awaiting signature */}
        {hintPurchaseState === "awaiting_signature" && purchaseIntent && (
          <div className="w-full max-w-[400px] mt-4 rounded-xl border border-[#2563eb]/30 bg-[#2563eb]/10 px-3 py-2 text-xs text-[#60a5fa]">
            <div className="flex items-center justify-between">
              <span>USDC to:</span>
              <span className="font-mono">{shortAddress(purchaseIntent.treasuryAddress)}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span>Amount:</span>
              <span className="font-mono">
                {(Number(purchaseIntent.requiredUsdc) / 1_000_000).toFixed(2)} USDC
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="w-full max-w-[400px] flex gap-3 mt-4">
          <button
            className={`h-12 flex-1 rounded-full border text-sm font-semibold transition-all ${
              hintButtonDisabled && remainingHints > 0
                ? "border-white/20 bg-white/5 text-white/60"
                : remainingHints > 0
                ? "border-[#0052ff]/50 bg-[#0052ff]/20 text-[#6fa8ff] hover:bg-[#0052ff]/30"
                : "border-[#ff6b00]/50 bg-[#ff6b00]/20 text-[#ffb366] hover:bg-[#ff6b00]/30"
            }`}
            disabled={hintButtonDisabled && remainingHints > 0}
            onClick={handleHintButtonClick}
          >
            {getHintButtonContent()}
          </button>
          <button
            className="h-12 flex-1 rounded-full bg-white text-sm font-semibold text-[#0b1020]"
            onClick={handleRestart}
          >
            Restart
          </button>
        </div>

        {/* Purchase error */}
        {purchaseError && hintPurchaseState === "error" && (
          <div className="w-full max-w-[400px] mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {purchaseError}
          </div>
        )}

        {/* Game Over */}
        {isGameOver && (
          <div className="w-full max-w-[400px] mt-4 rounded-2xl border border-white/10 bg-[#111a33] p-4 text-center">
            <p className="text-lg font-semibold text-white">Game Over!</p>
            <p className="mt-1 text-sm text-[#9cc1ff]">
              Final Score: {gameState.score.toLocaleString()}
            </p>
            <div className="mt-4">
              {!isAuthed ? (
                <button
                  className="h-11 w-full rounded-full border border-[#0052ff]/50 bg-[#0052ff]/20 text-sm font-semibold text-[#6fa8ff]"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                >
                  {isSigningIn ? "Signing in…" : isMiniApp ? "Sign in (Farcaster) to submit" : "Sign in to submit"}
                </button>
              ) : (
                <button
                  className="h-11 w-full rounded-full bg-[#0052ff] text-sm font-semibold text-white"
                  onClick={handleSubmitScore}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Submitting..." : "Submit score"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ===============================
  // Main Render
  // ===============================

  return (
    <>
      {/* Welcome modal (once per day) */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[#111a33] border border-white/20 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Main App Shell */}
      <div className="min-h-screen bg-[#0a0a12] text-white">
        {/* Desktop Layout (>= 1024px) */}
        <div className="hidden lg:flex h-screen">
          {/* Left Panel - Account */}
          <aside className="w-72 shrink-0 border-r border-white/10 bg-[#0d0d18] overflow-y-auto">
            <div className="p-4 h-full">
              <AccountView
                authToken={authToken}
                authAddress={authAddress}
                authFid={authFid}
                isSigningIn={isSigningIn}
                isMiniApp={isMiniApp}
                isConnected={isConnected}
                address={address}
                isOnBase={isOnBase}
                isConnecting={isConnecting}
                onConnect={handleConnect}
                onDisconnect={() => { disconnect(); clearAuth(); }}
                onSignIn={handleSignIn}
                onSignOut={clearAuth}
                onSwitchToBase={handleSwitchToBase}
                compact
              />
            </div>
          </aside>

          {/* Center Panel - Game / GM Streak */}
          <main className="flex-1 overflow-y-auto pb-20">
            {renderCenterContent()}
          </main>

          {/* Right Panel - Leaderboard */}
          <aside className="w-80 shrink-0 border-l border-white/10 bg-[#0d0d18] overflow-y-auto">
            <div className="p-4 h-full">
              <LeaderboardView
                mode={leaderboardMode}
                onModeChange={setLeaderboardMode}
                entries={leaderboardResults}
                loading={leaderboardLoading}
                ensNames={ensNames}
                currentAddress={address || null}
                currentScore={gameState?.score ?? null}
                isGameOver={isGameOver}
                isAuthed={isAuthed}
                isSubmitting={isSubmitting}
                onSubmitScore={handleSubmitScore}
                compact
              />
            </div>
          </aside>
        </div>

        {/* Mobile Layout (< 1024px) */}
        <div className="lg:hidden min-h-screen pb-20">
          {renderCenterContent()}
        </div>

        {/* Bottom Navigation */}
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </>
  );
}
