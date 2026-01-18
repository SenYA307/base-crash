"use client";

import { useEffect, useState } from "react";

type ComboOverlayProps = {
  multiplier: number; // 2, 3, 4, etc.
  onComplete?: () => void;
};

export default function ComboOverlay({ multiplier, onComplete }: ComboOverlayProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 1200);

    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!visible || multiplier < 2) return null;

  return (
    <div className="combo-overlay pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="combo-text flex flex-col items-center">
        <span className="text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(0,82,255,1)]">
          COMBO
        </span>
        <span className="text-6xl font-black text-[#0052ff] drop-shadow-[0_0_30px_rgba(0,82,255,0.8)]">
          x{multiplier}
        </span>
      </div>
    </div>
  );
}
