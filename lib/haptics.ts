const HAPTICS_STORAGE_KEY = "base-crash-haptics";

/**
 * Check if haptics are enabled (from localStorage).
 */
export function isHapticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(HAPTICS_STORAGE_KEY);
  // Default to enabled on mobile
  if (stored === null) {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }
  return stored === "true";
}

/**
 * Set haptics enabled/disabled.
 */
export function setHapticsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(HAPTICS_STORAGE_KEY, String(enabled));
}

/**
 * Trigger haptic feedback if enabled and supported.
 */
export function triggerHaptic(durationMs: number = 10): void {
  if (!isHapticsEnabled()) return;
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // Vibration not supported or blocked
    }
  }
}

/**
 * Light haptic for matches.
 */
export function hapticMatch(): void {
  triggerHaptic(10);
}

/**
 * Medium haptic for power tile activation.
 */
export function hapticPowerTile(): void {
  triggerHaptic(20);
}

/**
 * Strong haptic for combos.
 */
export function hapticCombo(): void {
  triggerHaptic(30);
}

/**
 * Double tap haptic for special events.
 */
export function hapticSpecial(): void {
  triggerHaptic(15);
  setTimeout(() => triggerHaptic(15), 100);
}
