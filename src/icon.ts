/**
 * The file icon Windows shows for a .torrent.
 *
 * Without one, Explorer falls back to whatever generic archive glyph it has
 * lying around - which is what a registered .torrent looked like: a stock 3D
 * box with no relation to this app.
 *
 * Generated rather than shipped as a binary asset, and built at `--register`
 * time, so there is no image file to keep in sync with the package.
 *
 * The icon is the app's own dinosaur beside a cactus whose arms make a V -
 * the initial, and the thing a dinosaur is usually running past.
 *
 * **The dinosaur is scaled from `avatar.ts`, not redrawn.** The first version
 * was hand-drawn at icon size on the theory that detail which reads at 32px
 * has to be authored at 32px. It looked like a dinosaur and not like OURS,
 * which reads as some other application's icon - reported on sight. Scaling
 * the sprite by a whole number keeps the silhouette exactly, and there is now
 * one drawing of the dinosaur in the project rather than two that can drift.
 *
 * ICO with uncompressed BMP entries, deliberately. PNG-compressed entries are
 * legal since Vista and would be smaller, but BMP is understood by every
 * shell that has ever existed and needs no deflate or CRC.
 */

import { ICON_SPRITE } from "./avatar.js";

/** Transparent, dinosaur, cactus. */
const CHARS = { ".": 0, "D": 1, "C": 2 } as const;

const DINO = "#D97757";  // theme.claude accent - the app's own coral
const CACTUS = "#7FB069"; // theme.claude progress - the green used for bars

/**
 * The dinosaur, scaled from the header sprite rather than redrawn.
 *
 * Redrawing it by hand was the first attempt and it was wrong: the result
 * resembled a dinosaur but not OUR dinosaur, which reads as a different
 * application's icon. Scaling by a whole number keeps the silhouette exactly -
 * every sprite pixel becomes a square block, so the notched eye, the jaw and
 * the gap between the legs survive unchanged.
 */
function blitSprite(grid: string[][], scale: number, atX: number, atY: number): void {
  // The sprite is padded to 9 columns; trim the empty edges so the art can be
  // positioned by what is actually drawn rather than by its padding.
  const first = Math.min(...ICON_SPRITE.map(firstFilledCol));
  const last = Math.max(...ICON_SPRITE.map(lastFilledCol));

  for (let y = 0; y < ICON_SPRITE.length; y++) {
    for (let x = first; x <= last; x++) {
      if (ICON_SPRITE[y][x] === " ") continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = atX + (x - first) * scale + dx;
          const py = atY + y * scale + dy;
          if (grid[py]?.[px] !== undefined) grid[py][px] = "D";
        }
      }
    }
  }
}

/** First non-space column, or Infinity if the row is blank. */
function firstFilledCol(row: string): number {
  const i = row.search(/\S/);
  return i === -1 ? Infinity : i;
}

/** Last non-space column, or -1 if the row is blank. */
function lastFilledCol(row: string): number {
  for (let i = row.length - 1; i >= 0; i--) {
    if (row[i] !== " ") return i;
  }
  return -1;
}

/** Sprite columns actually drawn, for laying the canvas out. */
function spriteWidth(): number {
  const first = Math.min(...ICON_SPRITE.map(firstFilledCol));
  const last = Math.max(...ICON_SPRITE.map(lastFilledCol));
  return last - first + 1;
}

/**
 * A V whose arms meet at a point.
 *
 * The first version converged and then carried on downwards as a single stem,
 * which is a Y, not a V - reported immediately on seeing it. The arms now stop
 * where they meet.
 */
function drawV(
  grid: string[][],
  left: number, right: number, top: number, bottom: number, thickness: number,
): void {
  const middle = Math.floor((left + right) / 2) - Math.floor(thickness / 2);
  const rows = bottom - top;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const xl = Math.round(left + (middle - left) * t);
    const xr = Math.round(right - (right - middle) * t);
    for (let k = 0; k < thickness; k++) {
      const y = top + i;
      if (grid[y]?.[xl + k] === ".") grid[y][xl + k] = "C";
      if (grid[y]?.[xr + k] === ".") grid[y][xr + k] = "C";
    }
  }
}

/**
 * Lay out one icon.
 *
 * `vThickness` of 0 draws the dinosaur alone. At scale 3 it is 24 of 32
 * columns wide, which leaves five for the V - not enough for two converging
 * strokes to read as a letter rather than two bars. So the two are a genuine
 * trade: a big unmistakable dinosaur, or a smaller one with the V beside it.
 */
export function build(size: number, scale: number, vThickness: number): string[] {
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill("."));

  const dinoW = spriteWidth() * scale;
  const dinoH = ICON_SPRITE.length * scale;
  const dinoX = size - dinoW;                        // hard right
  const dinoY = size - dinoH - Math.round(size / 16); // standing near the base

  blitSprite(grid, scale, dinoX, dinoY);

  if (vThickness > 0) {
    /**
     * The V is TALLER than the dinosaur, sharing its baseline.
     *
     * Matching their heights left both shapes squashed into the bottom third
     * with the top half of the icon empty. Letting the V run most of the
     * canvas fills it, and a cactus standing taller than the animal beside it
     * is the arrangement anyone would expect anyway.
     *
     * Width is whatever the dinosaur left, less a column so they do not touch.
     */
    drawV(
      grid,
      0,
      Math.max(2, dinoX - 2 - vThickness),
      Math.round(size * 0.12),
      dinoY + dinoH - 1,
      vThickness,
    );
  }

  return grid.map(r => r.join(""));
}

/**
 * The two sizes.
 *
 * Both come from the same sprite at different whole-number scales, so neither
 * is a resample of the other: halving a 32px image would turn the one-pixel
 * eye into a smudge and close the gap between the legs. The smaller icon also
 * gets a thinner V, since a 2px stroke at 16px is most of the letter.
 */
const ART32 = build(32, 2, 2);
const ART16 = build(16, 1, 1);

function rgba(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * One ICO image entry: BITMAPINFOHEADER, BGRA pixels, then the AND mask.
 *
 * Two things here are easy to get wrong and produce a silently blank icon:
 * the header's height is DOUBLE the real height (it covers the colour data
 * and the mask together), and the rows are stored bottom-up.
 */
function bmpEntry(art: string[]): Uint8Array {
  const size = art.length;
  const dino = rgba(DINO);
  const cactus = rgba(CACTUS);

  const headerSize = 40;
  const pixelBytes = size * size * 4;
  // The AND mask is 1 bit per pixel with each row padded to 4 bytes. It is
  // redundant when the alpha channel is present, but it must still be there
  // and correctly sized or the shell reads past the end of the image.
  const maskRow = Math.ceil(size / 32) * 4;
  const maskBytes = maskRow * size;

  const out = new Uint8Array(headerSize + pixelBytes + maskBytes);
  const view = new DataView(out.buffer);

  view.setUint32(0, headerSize, true);
  view.setInt32(4, size, true);
  view.setInt32(8, size * 2, true); // colour data + mask
  view.setUint16(12, 1, true);      // planes
  view.setUint16(14, 32, true);     // bits per pixel
  view.setUint32(20, pixelBytes, true);

  let at = headerSize;
  for (let y = size - 1; y >= 0; y--) { // bottom-up
    const row = art[y];
    for (let x = 0; x < size; x++) {
      const kind = CHARS[(row[x] ?? ".") as keyof typeof CHARS] ?? 0;
      if (kind === 0) {
        at += 4; // transparent: zeroed already
        continue;
      }
      const [r, g, b] = kind === 1 ? dino : cactus;
      out[at++] = b;
      out[at++] = g;
      out[at++] = r;
      out[at++] = 255;
    }
  }
  return out;
}

/** A complete .ico holding both sizes. */
export function buildIcon(): Uint8Array {
  const images = [ART16, ART32].map(bmpEntry);
  const dirSize = 6 + images.length * 16;
  const total = dirSize + images.reduce((n, i) => n + i.length, 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);              // reserved
  view.setUint16(2, 1, true);              // 1 = icon
  view.setUint16(4, images.length, true);

  let offset = dirSize;
  [ART16, ART32].forEach((art, index) => {
    const entry = 6 + index * 16;
    const image = images[index];
    // 256 is stored as 0; neither of ours is that big, but the field is one
    // byte so anything larger would have to be.
    out[entry] = art.length >= 256 ? 0 : art.length;
    out[entry + 1] = art.length >= 256 ? 0 : art.length;
    out[entry + 2] = 0; // palette colours
    out[entry + 3] = 0; // reserved
    view.setUint16(entry + 4, 1, true);   // planes
    view.setUint16(entry + 6, 32, true);  // bits per pixel
    view.setUint32(entry + 8, image.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(image, offset);
    offset += image.length;
  });

  return out;
}

/** The art, for previewing without opening a file manager. */
export const ICON_ART = { small: ART16, large: ART32 };
