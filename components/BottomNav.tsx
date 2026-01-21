"use client";

import React from "react";

export type TabId = "game" | "leaderboard" | "gm" | "account";

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  /** Show compact version on desktop */
  compact?: boolean;
}

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "game",
    label: "Game",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: "leaderboard",
    label: "Ranks",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: "gm",
    label: "GM",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    id: "account",
    label: "Account",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

export function BottomNav({ activeTab, onTabChange, compact }: BottomNavProps) {
  return (
    <nav
      className={`
        fixed bottom-0 left-0 right-0 z-50
        bg-[#0a0a12]/95 backdrop-blur-lg
        border-t border-white/10
        ${compact ? "h-14" : "h-16"}
      `}
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className={`flex items-center justify-around h-full max-w-lg mx-auto ${compact ? "px-2" : "px-4"}`}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex flex-col items-center justify-center gap-0.5
                ${compact ? "px-3 py-1" : "px-4 py-2"}
                rounded-xl transition-all duration-200
                min-w-[60px]
                ${
                  isActive
                    ? "text-[#0052ff] bg-[#0052ff]/10"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }
              `}
            >
              <div className={isActive ? "scale-110" : ""}>{tab.icon}</div>
              <span className={`text-[10px] font-medium ${compact ? "hidden" : ""}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
