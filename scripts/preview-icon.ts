/**
 * Render the .torrent file icon to a PNG so it can be looked at.
 *
 * Dev-only: `files` in package.json ships dist/ alone, so nothing here goes
 * out with the package. It exists because the alternative to seeing the icon
 * is registering it and hunting for a file in Explorer.
 *
 *   bun run scripts/preview-icon.ts
 */
import { deflateSync } from "zlib";
import { ICON_ART } from "../src/icon.js";
import fs from "fs";
import path from "path";

const DINO = [0xD9, 0x77, 0x57];
const CACTUS = [0x7F, 0xB0, 0x69];
const BACKDROP = [0x1A, 0x18, 0x15]; // the app's own background, so alpha is visible

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Nearest-neighbour scale, so the pixels stay square and hard-edged. */
function png(art: string[], scale: number, onBackdrop: boolean): Uint8Array {
  const size = art.length;
  const w = size * scale;
  const raw = new Uint8Array((w * 4 + 1) * w);

  let at = 0;
  for (let y = 0; y < w; y++) {
    raw[at++] = 0; // filter: none
    const row = art[Math.floor(y / scale)];
    for (let x = 0; x < w; x++) {
      const ch = row[Math.floor(x / scale)] ?? ".";
      const colour = ch === "D" ? DINO : ch === "C" ? CACTUS : null;
      if (colour) {
        raw[at++] = colour[0]; raw[at++] = colour[1]; raw[at++] = colour[2]; raw[at++] = 255;
      } else if (onBackdrop) {
        raw[at++] = BACKDROP[0]; raw[at++] = BACKDROP[1]; raw[at++] = BACKDROP[2]; raw[at++] = 255;
      } else {
        at += 4; // transparent
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, w);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });

const { build } = await import("../src/icon.js");

const files: Array<[string, Uint8Array]> = [
  // The shipped pair.
  ["icon-32-dark.png", png(ICON_ART.large, 10, true)],
  ["icon-16-dark.png", png(ICON_ART.small, 20, true)],
  // Candidates, for choosing between layouts.
  ["option-a-dino-only.png", png(build(32, 4, 0), 10, true)],
  ["option-b-dino-and-v.png", png(build(32, 2, 2), 10, true)],
  ["option-c-big-dino-small-v.png", png(build(32, 3, 1), 10, true)],
];
for (const [name, bytes] of files) {
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log("wrote " + path.join(outDir, name));
}
