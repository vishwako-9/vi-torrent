import { fonts } from "@opentui/core";

/**
 * Build the ASCII-art rows for a word, as plain strings.
 *
 * ASCIIFontRenderable cannot do a travelling colour wave: its `color` array is
 * indexed by the font's OWN segment index (fill vs outline), not by position,
 * so every column of a given segment type is necessarily the same colour.
 * Rendering the glyphs ourselves gives one chunk per column, which is what a
 * positional wave needs.
 *
 * The font data stores each row as markup like `<c1>██</c1><c2>╗</c2>`, where
 * the tag number is that segment's colour index.
 */
export interface LogoCell {
  char: string;
  /** 1-based colour index from the font: 1 = fill, 2 = outline. */
  colorIndex: number;
  /**
   * Index into the source text this cell was drawn for (0-based, including
   * spaces and punctuation) - lets a caller colour per LETTER rather than
   * per cell, e.g. cycling each letter of "vi-torrent" through a different
   * theme colour. -1 for cells that belong to no letter (trailing padding).
   */
  letterIndex: number;
}

const TAG = /<c(\d+)>(.*?)<\/c\d+>/g;

function parseRow(markup: string): LogoCell[] {
  const cells: LogoCell[] = [];
  let match: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(markup)) !== null) {
    const index = Number(match[1]);
    for (const char of match[2]) cells.push({ char, colorIndex: index });
  }
  // A row with no tags at all is plain text (some fonts do this).
  if (cells.length === 0) {
    for (const char of markup) cells.push({ char, colorIndex: 1 });
  }
  return cells;
}

/**
 * Render `text` in `font` as a grid of cells, one per screen column.
 * Returns [] if the font or any glyph is missing, so callers can fall back.
 */
export function logoCells(text: string, font: keyof typeof fonts): LogoCell[][] {
  const def: any = (fonts as any)[font];
  if (!def?.chars || !def.lines) return [];

  const rows: LogoCell[][] = Array.from({ length: def.lines }, () => [] as LogoCell[]);
  const gap = def.letterspace_size ?? 1;

  let letterIndex = 0;
  for (const raw of text.toUpperCase()) {
    const glyph = def.chars[raw] ?? def.chars[" "];
    if (!glyph) return [];
    for (let line = 0; line < def.lines; line++) {
      const cells = parseRow(glyph[line] ?? "").map(c => ({ ...c, letterIndex }));
      rows[line].push(...cells);
      for (let g = 0; g < gap; g++) rows[line].push({ char: " ", colorIndex: 0, letterIndex });
    }
    letterIndex++;
  }

  // Pad to a rectangle. Glyph rows are not all the same length (a letter's
  // lower rows are often shorter), and a ragged grid would put column N of
  // one line above a different screen column of the next - so the wave would
  // read as skewed rather than vertical.
  const width = Math.max(...rows.map(r => r.length));
  for (const row of rows) {
    while (row.length < width) row.push({ char: " ", colorIndex: 0, letterIndex: -1 });
  }
  return rows;
}

/**
 * How strongly a column is lit, given the beam's CURRENT position - a
 * comet's tail, not codemie-opencode's fixed-width linear band (that
 * earlier version is still what `beamPos`'s own Timeline sweep-then-pause
 * timing is built on, see `research/docs/opentui-11-animation-timeline.md`;
 * only the per-column falloff SHAPE changed, 2026-08-09, after a reference
 * image showed a real comet's tail thinning out gradually over a long
 * distance, not cutting off at a hard 6-column edge).
 *
 * Exponential decay: `dist` (columns behind the beam) maps through
 * `exp(-dist / TAIL_DECAY)`, so it never has a hard edge, just a curve that
 * gets negligibly small - clamped to exactly 0 below a threshold so callers
 * can cheaply skip cells that are, for all practical purposes, unlit.
 * Ahead of the beam (`dist < 0`) there is nothing to render, same as
 * before.
 */
const TAIL_DECAY = 5;

export function cometIntensity(column: number, beamPos: number): number {
  const dist = beamPos - column;
  if (dist < 0) return 0;
  const t = Math.exp(-dist / TAIL_DECAY);
  return t < 0.02 ? 0 : t;
}

/**
 * Comet colour: a real comet's tail shifts HUE along its length, not just
 * brightness - white-hot at the very head, the letter's own colour just
 * behind it, a cool secondary hue further down the tail, fading to the
 * cell's resting colour at the tail's end. Four stops, piecewise-blended
 * and continuous at each boundary (verified: t=0.7 and t=0.25 both agree
 * between their adjacent branches). `restColour` is what the cell would be
 * outside the comet's reach entirely - passing it as a stop rather than
 * leaving a gap means a half-block cell straddling the tail's faint end
 * fades smoothly into the untouched logo instead of snapping to the cool
 * hue right up to the cutoff.
 */
export function cometColour(t: number, letterColour: string, coolColour: string, restColour: string): string {
  if (t > 0.7) return blend(letterColour, "#ffffff", (t - 0.7) / 0.3);
  if (t > 0.25) return blend(coolColour, letterColour, (t - 0.25) / 0.45);
  return blend(restColour, coolColour, t / 0.25);
}

/** Blend two "#rrggbb" colours. amount 0 gives `from`, 1 gives `to`. */
export function blend(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const mix = (a: number, b: number) =>
    Math.round(a + (b - a) * Math.max(0, Math.min(1, amount)))
      .toString(16)
      .padStart(2, "0");
  return "#" + mix(r1, r2) + mix(g1, g2) + mix(b1, b2);
}
