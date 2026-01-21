"use client";

import React from "react";

export type LeaderboardMode = "daily" | "weekly" | "alltime";

type LeaderboardEntry = {
  rank: number;
  address: string;
  score: number;
  created_at: number;
};

interface LeaderboardViewProps {
  mode: LeaderboardMode;
  onModeChange: (mode: LeaderboardMode) => void;
  entries: LeaderboardEntry[];
  loading: boolean;
  ensNames: Map<string, string | null>;
  
  // Current user
  currentAddress: string | null;
  currentScore: number | null;
  isGameOver: boolean;
  
  // Submit
  isAuthed: boolean;
  isSubmitting: boolean;
  onSubmitScore: () => void;
  
  // Optional: compact mode for desktop sidebar
  compact?: boolean;
}

function shortAddress(address?: string | null) {
  if (!address) return "";
  // Handle fid:123 format
  if (address.startsWith("fid:")) {
    return `FID ${address.slice(4)}`;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function LeaderboardView({
  mode,
  onModeChange,
  entries,
  loading,
  ensNames,
  currentAddress,
  currentScore,
  isGameOver,
  isAuthed,
  isSubmitting,
  onSubmitScore,
  compact,
}: LeaderboardViewProps) {
  const canSubmit = isGameOver && isAuthed && currentScore !== null && currentScore > 0;

  return (
    <div className={`flex flex-col h-full ${compact ? "" : "p-4"}`}>
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">Leaderboard</h2>
        <p className="text-xs text-white/50">Top players on Base</p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => onModeChange("daily")}
          className={`flex-1 py-2 px-2 rounded-xl text-xs font-medium transition-colors ${
            mode === "daily"
              ? "bg-[#0052ff] text-white"
              : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => onModeChange("weekly")}
          className={`flex-1 py-2 px-2 rounded-xl text-xs font-medium transition-colors ${
            mode === "weekly"
              ? "bg-[#0052ff] text-white"
              : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          Weekly
        </button>
        <button
          onClick={() => onModeChange("alltime")}
          className={`flex-1 py-2 px-2 rounded-xl text-xs font-medium transition-colors ${
            mode === "alltime"
              ? "bg-[#0052ff] text-white"
              : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          All Time
        </button>
      </div>

      {/* Weekly rewards banner */}
      {mode === "weekly" && (
        <div className="mb-4 p-3 rounded-xl border border-[#ff6b00]/30 bg-[#ff6b00]/10 text-center">
          <span className="text-sm text-[#ffb366]">🏆 Top 10 this week get rewards!</span>
        </div>
      )}

      {/* Submit Score CTA */}
      {currentScore !== null && currentScore > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-[#0052ff]/30 bg-[#0052ff]/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/70">Your Score</span>
            <span className="text-lg font-bold text-[#0052ff]">{currentScore.toLocaleString()}</span>
          </div>
          {canSubmit ? (
            <button
              onClick={onSubmitScore}
              disabled={isSubmitting}
              className="w-full py-2 px-4 rounded-xl bg-[#0052ff] text-white text-sm font-semibold hover:bg-[#0052ff]/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : (
                "Submit to Leaderboard"
              )}
            </button>
          ) : !isAuthed ? (
            <p className="text-xs text-center text-white/40">Sign in to submit your score</p>
          ) : !isGameOver ? (
            <p className="text-xs text-center text-white/40">Finish your game to submit</p>
          ) : null}
        </div>
      )}

      {/* Leaderboard List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="w-6 h-6 border-2 border-white/20 border-t-[#0052ff] rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-white/40 text-sm">
            No scores yet. Be the first!
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, index) => {
              const isCurrentUser = currentAddress && 
                entry.address.toLowerCase() === currentAddress.toLowerCase();
              const displayName = ensNames.get(entry.address) || shortAddress(entry.address);
              const rankEmoji = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;

              return (
                <div
                  key={`${entry.address}-${entry.created_at}`}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    isCurrentUser
                      ? "bg-[#0052ff]/20 border border-[#0052ff]/30"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  {/* Rank */}
                  <div className="w-8 text-center">
                    {rankEmoji ? (
                      <span className="text-lg">{rankEmoji}</span>
                    ) : (
                      <span className="text-sm text-white/50 font-mono">#{entry.rank}</span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {displayName}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-[#0052ff]">(you)</span>
                      )}
                    </div>
                  </div>

                  {/* Score */}
                  <div className="text-right">
                    <span className="text-sm font-bold text-white">
                      {entry.score.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
