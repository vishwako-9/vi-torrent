/**
 * Pixel avatars, drawn as block art.
 *
 * An original dinosaur in the spirit of an offline-game sprite - not a copy of
 * Chrome's, which is Google's artwork. Small enough to sit beside the logo
 * without stretching the header.
 *
 * Every returned frame is padded to FRAME_HEIGHT so the surrounding layout
 * never shifts: the jump is the sprite moving WITHIN a fixed block, not the
 * block changing size.
 */
import { lambert, type Lobe } from "./shading.js";

export type AvatarFrame = string[];

/** Rows every frame is padded to - one taller than the sprite, for the hop. */
export const FRAME_HEIGHT = 7;

/** Which colour a cell takes - see `avatarBrightness()`'s doc comment. */
export type CellRole = "body" | "belly" | "eye";

/**
 * Top/bottom brightness (0..1) for one cell, from a half-block split, plus
 * which of the dino's colours it belongs to - see `avatarBrightness()`.
 * `null` for a background cell (nothing to shade).
 */
export interface CellBrightness {
  top: number;
  bottom: number;
  role: CellRole;
}

/**
 * Real per-half brightness, not a hand-placed or quantised character ramp:
 * every filled cell renders as `▀` (upper half block), with its top half in
 * the caller's foreground colour and its bottom half in the caller's
 * background colour (`app.tsx` builds those from `avatarFrame`'s glyphs and
 * this brightness grid together). That's TWO independently-coloured samples
 * per terminal cell instead of one - a real answer to "the shading still
 * reads as flat, can we get finer control", not another shade of the same
 * one-sample-per-cell ramp (`shading.ts`'s `lambert` used to feed a 4-level
 * glyph ramp; here it's sampled twice per cell and blended into real colour
 * instead of being quantised into a character).
 *
 * The SHAPE below is the only hand-authored part, but it now has THREE
 * markers, not one: `#` = body (green when downloading, grey when idle -
 * `app.tsx` decides the actual colour), `@` = belly/feet (a fixed cream/tan,
 * matching the reference image's underside - a real animal's markings don't
 * change with app state, so this one isn't theme- or status-driven), `E` =
 * eye (fixed white top / black bottom, no lambert shading - an eye reads as
 * shiny, not matte skin, so it skips the lit-surface model entirely). The
 * eye marker REPLACES what used to be a blank gap standing in for an eye -
 * a real filled, two-tone cell reads as an actual eye instead of a notch,
 * which is what half-block rendering makes possible for the first time.
 *
 * The head (rows 0-3) and the body (row 4) are each treated as a circle
 * with its own centre, lit from the upper-left (`shading.ts`). Legs (row 5)
 * are a separate, unmodelled limb - flat, undimmed, rather than being lit
 * against either lobe's centre, which would stretch the light model past a
 * part it was never fitted to.
 */
const HEAD_LOBE: Lobe = { row: 1, col: 6 };
const BODY_LOBE: Lobe = { row: 4, col: 2 };

function lobeForRow(row: number): Lobe | null {
  if (row <= 3) return HEAD_LOBE;
  if (row === 4) return BODY_LOBE;
  return null;
}

/**
 * A pure Lambert value can get close to 0 for a surface almost fully turned
 * away from the light - physically correct, but on a tiny terminal sprite
 * blended toward a dark theme background (`app.tsx`'s `blend(background,
 * colour, brightness)`), near-0 brightness mixes almost entirely INTO that
 * background, so the shadow side reads as "mostly missing" rather than "in
 * shadow" (reported 2026-08-09 - looked like sparse dots against the dark
 * backdrop). Remapping the floor up trades a little physical accuracy for
 * legibility: the brightest cells are untouched (1 still maps to 1), only
 * the dim end is lifted off the background.
 */
const BRIGHTNESS_FLOOR = 0.35;
function withFloor(brightness: number): number {
  return BRIGHTNESS_FLOOR + brightness * (1 - BRIGHTNESS_FLOOR);
}

interface ShadedSprite {
  /** "▀" for a filled cell, " " for background - same shape/width as the mask. */
  frame: string[];
  /** Matches `frame` cell-for-cell; `null` wherever `frame` holds a space. */
  brightness: (CellBrightness | null)[][];
}

/** Shade a `#`/`@`/`E`/` ` silhouette mask via `shading.ts`, sampling twice per filled cell. */
function shadeSprite(mask: string[]): ShadedSprite {
  const frame: string[] = [];
  const brightness: (CellBrightness | null)[][] = [];
  for (let row = 0; row < mask.length; row++) {
    const lobe = lobeForRow(row);
    let frameRow = "";
    const brightRow: (CellBrightness | null)[] = [];
    for (let col = 0; col < mask[row].length; col++) {
      const marker = mask[row][col];
      if (marker === " ") {
        frameRow += " ";
        brightRow.push(null);
        continue;
      }
      frameRow += "▀";
      if (marker === "E") {
        brightRow.push({ top: 1, bottom: 1, role: "eye" });
      } else if (marker === "@") {
        brightRow.push({ top: 1, bottom: 1, role: "belly" });
      } else {
        brightRow.push(
          lobe
            ? {
                top: withFloor(lambert(row - 0.25, col, lobe)),
                bottom: withFloor(lambert(row + 0.25, col, lobe)),
                role: "body",
              }
            : { top: 1, bottom: 1, role: "body" },
        );
      }
    }
    frame.push(frameRow);
    brightness.push(brightRow);
  }
  return { frame, brightness };
}

const MASK_LEFT = [
  "    #### ",
  "    #E###",
  "    #####",
  "    ##   ",
  " ######  ",
  "  @@ @@  ",
];

const MASK_RIGHT = [
  "    #### ",
  "    #E###",
  "    #####",
  "    ##   ",
  " ######  ",
  "  @   @  ",
];

/** Legs tucked, as they would be mid-hop. */
const MASK_JUMP = [
  "    #### ",
  "    #E###",
  "    #####",
  "    ##   ",
  " ######  ",
  "   @@@   ",
];

/** Eye closed - a blink, so it looks alive even when nothing is downloading. */
const MASK_BLINK = [
  "    #### ",
  "    #####",
  "    #####",
  "    ##   ",
  " ######  ",
  "  @@ @@  ",
];

const SPRITE_LEFT = shadeSprite(MASK_LEFT);
const SPRITE_RIGHT = shadeSprite(MASK_RIGHT);
const SPRITE_JUMP = shadeSprite(MASK_JUMP);
const SPRITE_BLINK = shadeSprite(MASK_BLINK);

/**
 * The pose the file icon is built from.
 *
 * Exported so [icon.ts](icon.ts) scales THIS rather than carrying its own
 * drawing of a dinosaur. An icon that only resembles the one in the header is
 * worse than no icon: it reads as a different application. Legs apart, since
 * the icon is a still and a standing sprite should look planted.
 */
export const ICON_SPRITE = SPRITE_LEFT.frame;

const BLANK = " ".repeat(9);

function pad<T>(rows: T[], top: number, blankRow: T): T[] {
  const out = [...Array(top).fill(blankRow), ...rows];
  while (out.length < FRAME_HEIGHT) out.push(blankRow);
  return out.slice(0, FRAME_HEIGHT);
}

const SPRITES = {
  dino: { left: SPRITE_LEFT, right: SPRITE_RIGHT, jump: SPRITE_JUMP, blink: SPRITE_BLINK },
} as const;

export type AvatarName = keyof typeof SPRITES;

const BLANK_BRIGHTNESS: (CellBrightness | null)[] = Array(9).fill(null);

/**
 * Pick the pose for this tick, shared by `avatarFrame` and `avatarBrightness`
 * so the two never drift out of sync with each other's timing.
 *
 * It is ALWAYS animated. While `running` the legs alternate every tick and it
 * hops periodically; while idle it shuffles slowly and blinks. An avatar that
 * freezes whenever nothing is downloading just looks broken - which is
 * exactly how the first version came across, since a fresh app has no active
 * torrents and the dino never moved at all.
 */
function pickPose(name: AvatarName, running: boolean, tick: number): { sprite: ShadedSprite; top: number } {
  const avatar = SPRITES[name];

  if (!running) {
    // Idle: a blink every couple of seconds, otherwise a slow weight shift.
    const beat = tick % 24;
    if (beat === 0 || beat === 1) return { sprite: avatar.blink, top: 1 };
    return { sprite: beat % 8 < 4 ? avatar.left : avatar.right, top: 1 };
  }

  // A 12-tick cycle: two ticks airborne, the rest running on the ground.
  const beat = tick % 12;
  if (beat === 0 || beat === 1) return { sprite: avatar.jump, top: 0 };
  return { sprite: beat % 2 === 0 ? avatar.left : avatar.right, top: 1 };
}

export function avatarFrame(name: AvatarName, running: boolean, tick: number): AvatarFrame {
  const { sprite, top } = pickPose(name, running, tick);
  return pad(sprite.frame, top, BLANK);
}

/** The brightness grid matching `avatarFrame`'s glyphs, cell for cell. */
export function avatarBrightness(name: AvatarName, running: boolean, tick: number): (CellBrightness | null)[][] {
  const { sprite, top } = pickPose(name, running, tick);
  return pad(sprite.brightness, top, BLANK_BRIGHTNESS);
}

/** Widest row, so callers can size a box without measuring every line. */
export function avatarWidth(frame: AvatarFrame): number {
  return Math.max(...frame.map(row => row.length));
}
