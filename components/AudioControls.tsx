"use client";

import { useState, useEffect } from "react";
import {
  getSettings,
  setMusicEnabled,
  setSfxEnabled,
  isInitialized,
} from "@/lib/audio";

export default function AudioControls() {
  const [musicOn, setMusicOn] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Sync with audio manager after it initializes
    const check = () => {
      if (isInitialized()) {
        const s = getSettings();
        setMusicOn(s.musicEnabled);
        setSfxOn(s.sfxEnabled);
        setReady(true);
      }
    };
    check();
    // Poll briefly in case init happens after mount
    const interval = setInterval(check, 500);
    return () => clearInterval(interval);
  }, []);

  if (!ready) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          const newVal = !musicOn;
          setMusicOn(newVal);
          setMusicEnabled(newVal);
        }}
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs transition-colors ${
          musicOn
            ? "border-[#0052ff]/50 bg-[#0052ff]/20 text-[#6fa8ff]"
            : "border-white/20 bg-white/5 text-white/40"
        }`}
        title={musicOn ? "Music On" : "Music Off"}
      >
        🎵
      </button>
      <button
        type="button"
        onClick={() => {
          const newVal = !sfxOn;
          setSfxOn(newVal);
          setSfxEnabled(newVal);
        }}
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs transition-colors ${
          sfxOn
            ? "border-[#0052ff]/50 bg-[#0052ff]/20 text-[#6fa8ff]"
            : "border-white/20 bg-white/5 text-white/40"
        }`}
        title={sfxOn ? "SFX On" : "SFX Off"}
      >
        🔊
      </button>
    </div>
  );
}
