#!/usr/bin/env node

/**
 * Generate placeholder PNG images for Base Crash mini app.
 * Uses pure Node.js to create minimal valid PNGs.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const OUTPUT_DIR = path.join(process.cwd(), 'public', 'assets', 'miniapp');

// Base blue color: #0052ff
const BASE_BLUE = { r: 0, g: 82, b: 255 };
// Dark background: #0b1020
const DARK_BG = { r: 11, g: 16, b: 32 };

/**
 * Create a minimal valid PNG with solid color
 */
function createPNG(width, height, color) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(2, 9);   // color type (RGB)
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk (compressed image data)
  // Create raw image data: filter byte + RGB pixels for each row
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < width; x++) {
      rawData.push(color.r, color.g, color.b);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = makeCrcTable();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeCrcTable() {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('Generating mini app images...');

// OG image: 1200x630
const ogPng = createPNG(1200, 630, BASE_BLUE);
fs.writeFileSync(path.join(OUTPUT_DIR, 'og.png'), ogPng);
console.log('✓ og.png (1200x630)');

// Hero image: 1200x630 (same as OG)
fs.writeFileSync(path.join(OUTPUT_DIR, 'hero.png'), ogPng);
console.log('✓ hero.png (1200x630)');

// Screenshots: 1284x2778 (portrait)
const screenshotPng = createPNG(1284, 2778, DARK_BG);
fs.writeFileSync(path.join(OUTPUT_DIR, 's1.png'), screenshotPng);
console.log('✓ s1.png (1284x2778)');
fs.writeFileSync(path.join(OUTPUT_DIR, 's2.png'), screenshotPng);
console.log('✓ s2.png (1284x2778)');
fs.writeFileSync(path.join(OUTPUT_DIR, 's3.png'), screenshotPng);
console.log('✓ s3.png (1284x2778)');

console.log('\nDone! Images saved to:', OUTPUT_DIR);
