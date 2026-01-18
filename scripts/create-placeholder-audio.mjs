#!/usr/bin/env node
/**
 * Creates minimal silent MP3 placeholder files for audio
 * These are tiny valid MP3 files that play silence
 * Run: node scripts/create-placeholder-audio.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "public", "audio");

// Minimal silent MP3 (173 bytes) - valid MP3 with ~0.1s of silence
// This is a base64-encoded minimal MP3 frame
const SILENT_MP3_BASE64 =
  "//uQxAAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";

const AUDIO_FILES = ["bgm.mp3", "swap.mp3", "match.mp3", "cascade.mp3", "gameover.mp3"];

function main() {
  console.log("🔊 Creating placeholder audio files...\n");

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created directory: ${OUTPUT_DIR}\n`);
  }

  const silentBuffer = Buffer.from(SILENT_MP3_BASE64, "base64");

  for (const filename of AUDIO_FILES) {
    const filePath = join(OUTPUT_DIR, filename);
    if (existsSync(filePath)) {
      console.log(`  ⏭️  ${filename} (already exists)`);
    } else {
      writeFileSync(filePath, silentBuffer);
      console.log(`  ✅ ${filename} (placeholder created)`);
    }
  }

  console.log("\n✨ Done! Replace these with real audio files for sound effects.");
}

main();
