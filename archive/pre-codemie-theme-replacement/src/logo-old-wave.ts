// Archived 2026-08-09. The continuous two-hue cosine wave that animated the
// logo before the codemie-opencode animation replacement (sweep-once-then-
// pause, single hue). Was `wavePosition` in src/logo.ts, called from
// app.tsx's paintHeader() as `blend(theme.accent, theme.accent2, lit)`.

/**
 * Colour for a column at a given wave phase.
 *
 * Returns a value in 0..1 - how strongly this column is lit. Callers blend
 * between two theme colours with it. The wave is a raised cosine so it reads
 * as a smooth band travelling left to right, rather than a hard edge.
 */
export function wavePosition(column: number, phase: number, width = 18): number {
  const t = (column / width) - phase;
  return (Math.cos(t * Math.PI * 2) + 1) / 2;
}
