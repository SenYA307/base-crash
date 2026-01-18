"use client";

import { useState, useEffect } from "react";

const WELCOME_STORAGE_KEY = "base-crash-welcome-shown";

function getTodayUTC(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export default function WelcomeModal({ onClose }: { onClose: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const lastShown = localStorage.getItem(WELCOME_STORAGE_KEY);
    const today = getTodayUTC();

    if (lastShown !== today) {
      setShow(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(WELCOME_STORAGE_KEY, getTodayUTC());
    setShow(false);
    onClose();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1730] p-6 shadow-[0_20px_60px_rgba(0,82,255,0.3)]">
        {/* Close button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-4 top-4 text-white/60 hover:text-white text-xl leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="text-center text-2xl font-bold text-white mb-6">
          Welcome to Base Crash!
        </h2>

        <div className="space-y-4">
          {/* How to Play */}
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0052ff]/20 text-xl">
              🎮
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">How to Play</h3>
              <p className="text-xs text-[#9cc1ff] leading-relaxed">
                Match 3+ tokens by swapping adjacent tiles. Chain combos for bonus points.
              </p>
            </div>
          </div>

          {/* Goals */}
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0052ff]/20 text-xl">
              🎯
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Goals</h3>
              <p className="text-xs text-[#9cc1ff] leading-relaxed">
                Reach the target score before moves run out. Build streaks for big multipliers.
              </p>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0052ff]/20 text-xl">
              🏆
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Leaderboard</h3>
              <p className="text-xs text-[#9cc1ff] leading-relaxed">
                Compete with others on the global leaderboard. Top 10 players receive rewards.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="mt-6 h-12 w-full rounded-full bg-[#0052ff] text-sm font-semibold text-white shadow-[0_10px_25px_rgba(0,82,255,0.35)] active:scale-95 transition-transform"
        >
          Let&apos;s Play!
        </button>
      </div>
    </div>
  );
}
