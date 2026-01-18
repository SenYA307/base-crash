// Audio manager for Base Crash
// Handles SFX and background music with localStorage persistence

const AUDIO_STORAGE_KEY = "base-crash-audio";

type AudioSettings = {
  musicEnabled: boolean;
  sfxEnabled: boolean;
};

const defaultSettings: AudioSettings = {
  musicEnabled: true,
  sfxEnabled: true,
};

let settings: AudioSettings = { ...defaultSettings };
let initialized = false;
let audioUnlocked = false;

// Audio elements (created lazily)
let bgm: HTMLAudioElement | null = null;
let sfxSwap: HTMLAudioElement | null = null;
let sfxMatch: HTMLAudioElement | null = null;
let sfxCascade: HTMLAudioElement | null = null;
let sfxGameover: HTMLAudioElement | null = null;

// Track if we've logged errors to avoid spam
let hasLoggedError = false;

function loadSettings(): AudioSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (raw) {
      return { ...defaultSettings, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return defaultSettings;
}

function saveSettings() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

// Track which audio files failed to load
const failedAudio = new Set<string>();

function createAudio(src: string, loop = false): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  try {
    const audio = new Audio();
    audio.loop = loop;
    audio.preload = "auto";

    // Handle load errors gracefully
    audio.addEventListener("error", () => {
      if (!failedAudio.has(src)) {
        failedAudio.add(src);
        console.warn(`[Audio] Failed to load: ${src} (file may be missing)`);
      }
    });

    audio.src = src;
    return audio;
  } catch (e) {
    if (!hasLoggedError) {
      console.warn("[Audio] Failed to create audio element:", e);
      hasLoggedError = true;
    }
    return null;
  }
}

/**
 * Initialize audio (call after user gesture to unlock autoplay)
 * Must be called from a click/touch handler!
 */
export function initAudio() {
  if (initialized) return;
  initialized = true;

  settings = loadSettings();

  // Create audio elements
  bgm = createAudio("/audio/bgm.mp3", true);
  if (bgm) {
    bgm.volume = 0.3;
  }

  sfxSwap = createAudio("/audio/swap.mp3");
  sfxMatch = createAudio("/audio/match.mp3");
  sfxCascade = createAudio("/audio/cascade.mp3");
  sfxGameover = createAudio("/audio/gameover.mp3");

  // Set volumes for SFX
  [sfxSwap, sfxMatch, sfxCascade, sfxGameover].forEach((sfx) => {
    if (sfx) sfx.volume = 0.5;
  });

  audioUnlocked = true;
}

/**
 * Try to start background music.
 * Call this from a user gesture handler (e.g., Play button click).
 */
export function tryStartBgm() {
  if (!bgm || !settings.musicEnabled || !audioUnlocked) return;

  bgm.play().catch((e) => {
    if (!hasLoggedError) {
      console.warn("[Audio] BGM autoplay blocked:", e.message);
      hasLoggedError = true;
    }
  });
}

export function isInitialized() {
  return initialized;
}

export function getSettings(): AudioSettings {
  return { ...settings };
}

export function setMusicEnabled(enabled: boolean) {
  settings.musicEnabled = enabled;
  saveSettings();

  if (!bgm) return;

  if (enabled && audioUnlocked) {
    bgm.play().catch(() => {});
  } else {
    bgm.pause();
  }
}

export function setSfxEnabled(enabled: boolean) {
  settings.sfxEnabled = enabled;
  saveSettings();
}

function playSfx(audio: HTMLAudioElement | null) {
  if (!audio || !settings.sfxEnabled || !audioUnlocked) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playSwap() {
  playSfx(sfxSwap);
}

export function playMatch() {
  playSfx(sfxMatch);
}

export function playCascade() {
  playSfx(sfxCascade);
}

export function playGameOver() {
  playSfx(sfxGameover);
}

export function stopBgm() {
  if (!bgm) return;
  bgm.pause();
  bgm.currentTime = 0;
}

export function pauseBgm() {
  if (!bgm) return;
  bgm.pause();
}

export function resumeBgm() {
  if (!bgm || !settings.musicEnabled || !audioUnlocked) return;
  bgm.play().catch(() => {});
}
