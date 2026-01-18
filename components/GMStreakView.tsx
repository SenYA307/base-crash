"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const GM_LOCAL_STORAGE_KEY = "base-crash-gm-local";

type GMState = {
  streak: number;
  canCheckIn: boolean;
  lastCheckInUtc: number;
  nextResetUtc: number;
};

function getUTCDayStart(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
}

function getNextUTCMidnight(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Minimal confetti using canvas
function triggerConfetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const particles: { x: number; y: number; vx: number; vy: number; color: string; size: number }[] = [];
  const colors = ["#0052ff", "#4d8aff", "#ff6b00", "#00ff88", "#ff00ff", "#ffff00"];

  for (let i = 0; i < 80; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12 - 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
    });
  }

  let frame = 0;
  const maxFrames = 60;

  function animate() {
    if (frame >= maxFrames) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3; // gravity
      p.vx *= 0.98; // friction

      const alpha = 1 - frame / maxFrames;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    frame++;
    requestAnimationFrame(animate);
  }

  animate();
}

type Props = {
  authToken: string | null;
  onBack: () => void;
};

export default function GMStreakView({ authToken, onBack }: Props) {
  const [state, setState] = useState<GMState>({
    streak: 0,
    canCheckIn: true,
    lastCheckInUtc: 0,
    nextResetUtc: getNextUTCMidnight(),
  });
  const [countdown, setCountdown] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load state from server or localStorage
  const loadState = useCallback(async () => {
    setIsLoading(true);

    if (authToken) {
      try {
        const res = await fetch("/api/gm/status", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setState(data);
          setIsLoading(false);
          return;
        }
      } catch {
        // Fall through to local
      }
    }

    // Local storage fallback
    const stored = localStorage.getItem(GM_LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const todayStart = getUTCDayStart();
        const yesterdayStart = todayStart - 86400000;

        // Check if can check in today
        const canCheckIn = parsed.lastCheckInUtc < todayStart;

        // Check if streak is still valid (checked in yesterday or today)
        let streak = parsed.streak || 0;
        if (parsed.lastCheckInUtc < yesterdayStart) {
          // Missed a day, streak would reset on next checkin
          streak = 0;
        }

        setState({
          streak,
          canCheckIn,
          lastCheckInUtc: parsed.lastCheckInUtc || 0,
          nextResetUtc: getNextUTCMidnight(),
        });
      } catch {
        // Invalid data
      }
    }

    setIsLoading(false);
  }, [authToken]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const remaining = state.nextResetUtc - Date.now();
      setCountdown(formatCountdown(remaining));

      // Refresh state when reset time passes
      if (remaining <= 0) {
        loadState();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [state.nextResetUtc, loadState]);

  const handleCheckIn = async () => {
    if (!state.canCheckIn || isCheckingIn) return;

    setIsCheckingIn(true);

    if (authToken) {
      try {
        const res = await fetch("/api/gm/checkin", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setState({
            streak: data.streak,
            canCheckIn: false,
            lastCheckInUtc: data.lastCheckInUtc,
            nextResetUtc: data.nextResetUtc,
          });
          setShowSuccess(true);
          if (canvasRef.current) triggerConfetti(canvasRef.current);
          setIsCheckingIn(false);
          return;
        }
      } catch {
        // Fall through to local
      }
    }

    // Local storage fallback
    const todayStart = getUTCDayStart();
    const yesterdayStart = todayStart - 86400000;
    const now = Date.now();

    let newStreak: number;
    if (state.lastCheckInUtc >= yesterdayStart && state.lastCheckInUtc < todayStart) {
      newStreak = state.streak + 1;
    } else {
      newStreak = 1;
    }

    const newState = {
      streak: newStreak,
      canCheckIn: false,
      lastCheckInUtc: now,
      nextResetUtc: getNextUTCMidnight(),
    };

    localStorage.setItem(GM_LOCAL_STORAGE_KEY, JSON.stringify(newState));
    setState(newState);
    setShowSuccess(true);
    if (canvasRef.current) triggerConfetti(canvasRef.current);
    setIsCheckingIn(false);
  };

  return (
    <main className="mt-6 flex flex-1 flex-col gap-4 safe-area-padding">
      {/* Canvas for confetti */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-50"
        width={typeof window !== "undefined" ? window.innerWidth : 400}
        height={typeof window !== "undefined" ? window.innerHeight : 700}
      />

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">GM Streak</h2>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white"
        >
          Back
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {isLoading ? (
          <p className="text-white/70">Loading...</p>
        ) : (
          <>
            {/* Streak display */}
            <div className="text-center">
              <p className="text-[#8aa8ff] text-sm uppercase tracking-widest mb-2">
                Current Streak
              </p>
              <p className="text-7xl font-black text-white">
                {state.streak}
              </p>
              <p className="text-[#9cc1ff] text-sm mt-1">
                {state.streak === 1 ? "day" : "days"}
              </p>
            </div>

            {/* GM Button */}
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={!state.canCheckIn || isCheckingIn}
              className={`h-32 w-32 rounded-full text-2xl font-bold transition-all active:scale-95 ${
                state.canCheckIn
                  ? "bg-[#0052ff] text-white shadow-[0_10px_40px_rgba(0,82,255,0.5)]"
                  : "bg-white/10 text-white/50 cursor-not-allowed"
              }`}
            >
              {isCheckingIn ? "..." : showSuccess && !state.canCheckIn ? "GM ✅" : state.canCheckIn ? "Tap to GM" : "GM ✅"}
            </button>

            {/* Status */}
            <p className="text-sm text-[#9cc1ff]">
              {state.canCheckIn ? "Ready to check in!" : "Already GM'd today"}
            </p>

            {/* Countdown */}
            <div className="text-center">
              <p className="text-[#8aa8ff] text-xs uppercase tracking-widest">
                Next reset in
              </p>
              <p className="text-2xl font-mono text-white mt-1">
                {countdown}
              </p>
            </div>

            {!authToken && (
              <p className="text-xs text-[#8aa8ff] text-center max-w-xs">
                Connect wallet & sign in to save your streak to the cloud.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
