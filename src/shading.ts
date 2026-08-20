/**
 * Real Lambertian shading, computed from geometry - not hand-placed density
 * like the logo's edge treatment (`app.tsx`) or the avatar's first pass
 * (see `avatar.ts`'s git history 2026-08-09). A `Lobe` stands in for a
 * locally round part of a shape - the dino's head or body - as a circle
 * with a centre. For a point on that circle's rim, the outward surface
 * normal points straight from the centre through the point, exactly as it
 * does on a real sphere. Brightness is that normal dotted with the light
 * direction (Lambert's cosine law): positive means facing the light, zero
 * or negative means facing away, clamped to unlit.
 */
export interface Lobe {
  row: number;
  col: number;
}

/**
 * Terminal cells read roughly twice as tall as they are wide, so a raw
 * (col, row) delta looks vertically stretched once normalised - a light
 * from "upper-left" would read as coming from almost directly above.
 * Scaling the row delta down before normalising corrects for that, so 45
 * degrees looks like 45 degrees.
 */
const ROW_ASPECT = 0.5;

function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Light direction: upper-left, in the same (col, row) convention as the normal below. */
const LIGHT = normalize(-1, -1);

/** The outward surface normal at (row, col) on a circle centred at `lobe`. */
function surfaceNormal(row: number, col: number, lobe: Lobe): { x: number; y: number } {
  return normalize(col - lobe.col, (row - lobe.row) / ROW_ASPECT);
}

/**
 * Half-Lambert shading: `(dot + 1) / 2` instead of the textbook `max(0, dot)`.
 * A hard clamp sends every surface facing away from the light straight to 0
 * - on a small, mostly-round silhouette like the dino's head, that means
 * anything below the lobe centre (most of the jaw) goes to pure black.
 * Half-Lambert is a real, named technique (Valve's Half-Life 2 engine used
 * it for the same reason: cheap geometry reading as unlit blackness looks
 * wrong long before it looks physically correct) - it remaps the full -1..1
 * dot-product range onto 0..1, so the far side of the curve stays dim
 * rather than vanishing.
 */
export function lambert(row: number, col: number, lobe: Lobe): number {
  const n = surfaceNormal(row, col, lobe);
  const dot = n.x * LIGHT.x + n.y * LIGHT.y;
  return (dot + 1) / 2;
}
