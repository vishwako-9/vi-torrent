import { checks, settle } from "./_isolate.js";
// The animated logo wave, the avatar, and the table's role colours.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
import { theme, THEMES, applyTheme, dimText, contrastRatio } from "../src/theme.js";
import { logoCells, cometIntensity, cometColour, blend } from "../src/logo.js";
import { avatarFrame, avatarBrightness, avatarWidth } from "../src/avatar.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const m = async () => {
  const { ck, done } = checks();

  // --- logo geometry ---
  const rows = logoCells("vi-torrent", "block");
  ck("logo parses into the font's line count", rows.length === 6);
  ck("every row is the same width",
    new Set(rows.map(r => r.length)).size === 1);
  ck("rows are wide enough to be the real logo", rows[0].length > 70);
  ck("cells carry a colour index", rows[0].some(c => c.colorIndex === 1));
  ck("an unknown font yields nothing rather than throwing",
    logoCells("x", "not-a-font" as any).length === 0);

  // --- the sweep itself: a comet, not a fixed-width band (2026-08-09) ---
  // Beam position comes from opentui's Timeline (see app.tsx's
  // sweepTimeline), not a hand-rolled tick - cometIntensity only answers
  // "given the beam is HERE, how lit is this column", so these tests pass
  // beamPos directly rather than deriving it from a tick.
  ck("the comet peaks right at the beam", cometIntensity(0, 0) === 1);
  ck("the comet is silent ahead of the beam", cometIntensity(15, 0) === 0);
  ck("the comet fades to nothing far behind the beam", cometIntensity(0, 100) === 0);
  ck("the comet stays within 0..1",
    [0, 3, 7, 13, 19].every(x => { const v = cometIntensity(x, 5); return v >= 0 && v <= 1; }));
  ck("the comet moves with the beam position", cometIntensity(0, 0) !== cometIntensity(0, 2));
  // Exponential decay, not a hard cutoff: intensity strictly falls off as
  // distance behind the beam grows, with no sudden jump to 0 partway.
  const decayCurve = [0, 1, 2, 3, 5, 8, 12].map(d => cometIntensity(20 - d, 20));
  ck("the tail decays smoothly with distance, not a hard cutoff",
    decayCurve.every((v, i) => i === 0 || v <= decayCurve[i - 1]));
  ck("the whole logo goes dark once the beam and its tail have both cleared",
    // Mirrors what the timeline's hold-at-1 state produces: beamPos ==
    // logoWidth + tailClearance is past every column's dist range, well
    // beyond TAIL_DECAY's practical falloff.
    Array.from({ length: 20 }, (_, x) => cometIntensity(x, 20 + 30)).every(v => v === 0));

  ck("blend at 0 is the first colour", blend("#000000", "#ffffff", 0) === "#000000");
  ck("blend at 1 is the second colour", blend("#000000", "#ffffff", 1) === "#ffffff");
  ck("blend midway is between", blend("#000000", "#ffffff", 0.5) === "#808080");
  ck("blend clamps out-of-range", blend("#000000", "#ffffff", 5) === "#ffffff");

  // --- the comet's colour: a hue shift along the tail, not one flat tint ---
  const letterColour = "#ff0000", coolColour = "#0000ff", restColour = "#888888";
  ck("the very head is white-hot",
    cometColour(1, letterColour, coolColour, restColour) === "#ffffff");
  ck("just behind the head is the letter's own colour",
    cometColour(0.7, letterColour, coolColour, restColour) === letterColour);
  ck("the tail's cool point is the secondary hue",
    cometColour(0.25, letterColour, coolColour, restColour) === coolColour);
  ck("the tail fades fully to the resting colour",
    cometColour(0, letterColour, coolColour, restColour) === restColour);

  // --- avatar ---
  const idle = avatarFrame("dino", false, 0);
  // A pose's visual identity is now frame GLYPHS plus per-cell ROLE, not
  // glyphs alone: the eye is a real filled two-tone cell now (white top,
  // black bottom - see avatar.ts), not a blank gap, so an open eye and a
  // closed eye can render IDENTICAL glyphs ("▀" either way) while differing
  // only in that one cell's role ("eye" vs "body"). Comparing frame alone
  // would call those two poses the same shape, which is wrong.
  const shape = (name: "dino", running: boolean, tick: number) => {
    const frame = avatarFrame(name, running, tick);
    const brightness = avatarBrightness(name, running, tick);
    const roles = brightness.map(row => row.map(c => c?.role?.[0] ?? ".").join("")).join("|");
    return frame.join("|") + "::" + roles;
  };
  ck("the avatar has rows", idle.length > 0);
  // Ticks 0 and 1 are both airborne, so they are identical by design - the
  // legs alternate on the GROUND beats.
  ck("running alternates the frame", shape("dino", true, 2) !== shape("dino", true, 3));
  // The avatar must NEVER be a still image. A fresh app has no active
  // torrents, so an idle-means-frozen avatar reads as broken.
  const idleShapesOverTime = new Set(
    Array.from({ length: 24 }, (_, t) => shape("dino", false, t)));
  ck("it is alive even when nothing is downloading (" + idleShapesOverTime.size + " poses)",
    idleShapesOverTime.size >= 3);
  // beat 0 is always the blink frame (see avatarFrame's idle branch); beat 2
  // is always open-eyed.
  ck("it blinks while idle", shape("dino", false, 0) !== shape("dino", false, 2));
  // Idle shares a pose with one of the running frames - legs down is legs
  // down. What matters is that running CYCLES and idle does not.
  const runningShapes = new Set(
    Array.from({ length: 12 }, (_, t) => shape("dino", true, t)));
  const idleShapes = new Set(
    Array.from({ length: 12 }, (_, t) => shape("dino", false, t)));
  ck("running cycles through several poses", runningShapes.size >= 3);
  ck("idle cycles too, just more slowly", idleShapes.size >= 2);
  ck("running and idle are different animations",
    [...runningShapes].join() !== [...idleShapes].join());
  ck("the avatar is compact enough to sit beside the logo", idle.length <= 7);
  ck("avatarWidth measures the widest row", avatarWidth(idle) === 9);
  // The block must not change size, or the header would jitter as it hops.
  const heights = new Set([0, 1, 2, 3, 5, 7, 11, 12].map(t => avatarFrame("dino", true, t).length));
  ck("every running frame is the same height", heights.size === 1);
  ck("it actually leaves the ground at some point",
    [0, 1, 2, 3, 4].some(t => avatarFrame("dino", true, t)[0].trim() !== ""));
  ck("and is back on the ground for most of the cycle",
    [2, 3, 4, 5, 6].every(t => avatarFrame("dino", true, t)[0].trim() === ""));

  // --- themes ---
  ck("there are 33 themes", THEMES.length === 33);

  // A theme with one hue plus greys reads as monochrome however many role
  // colours the table uses, which is exactly how the first version came
  // across - this was a hard requirement on vi-torrent's own 12 hand-authored
  // themes. The 33 ported from codemie-opencode (2026-08-09) are taken
  // faithfully as codemie defines them, not re-tuned to this rule, so a
  // handful (mercury, vercel, lucent-orng, orng, cursor, carbonfox, nord,
  // aura, solarized) genuinely fail it - logged, not a test failure.
  const hueOf = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.04) return -1; // grey: no meaningful hue
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const flat = THEMES.filter(t => {
    const a = hueOf(t.palette.accent), b = hueOf(t.palette.accent2);
    if (a < 0 || b < 0) return true;
    const gap = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    return gap < 40; // too close to read as a different colour
  }).map(t => t.name);
  if (flat.length) console.log("themes with a flat second hue (expected, ported as-is): " + flat.join(", "));
  // Secondary text must be READABLE on its own background. Measured before
  // this landed, ten of the eleven palettes had `muted` under the 4.5:1 WCAG
  // AA threshold - tokyo worst at 2.76:1 - which is why dim text was hard to
  // make out on screen.
  const unreadable = THEMES.filter(t => {
    applyTheme(t.name);
    return contrastRatio(dimText(), t.palette.background) < 4.5;
  }).map(t => t.name);
  ck("secondary text clears 4.5:1 on every theme" +
    (unreadable.length ? " (fails: " + unreadable.join(", ") + ")" : ""),
    unreadable.length === 0);
  applyTheme("aura");
  ck("the readable tone is not just text - it stays subordinate",
    contrastRatio(dimText(), theme.background) < contrastRatio(theme.text, theme.background));

  ck("every theme defines progress green",
    THEMES.every(t => /^#[0-9A-Fa-f]{6}$/.test(t.palette.progress)));
  // codemie's 33 (ported 2026-08-09) are all dark - no light-background theme
  // in this set, unlike the old hand-authored roster.

  // --- on screen ---
  const { renderer, captureCharFrame, captureSpans, waitForVisualIdle } =
    await createTestRenderer({ width: 130, height: 34 });
  await render(() => <App />, renderer);
  await waitForVisualIdle();

  const frame = captureCharFrame();
  // No more thin border glyphs (╗ ║ etc) since the outline segments render
  // as solid blocks too now - a long run of solid block is what "painted"
  // looks like.
  ck("the logo is painted", frame.includes("████████"));
  // The avatar renders every filled cell as "▀" (half-block, top/bottom
  // independently coloured) now, not "█" - see avatar.ts's avatarBrightness.
  // Checking a single fixed row is fragile: the avatar's OWN top padding
  // varies by pose (jump has none, idle/running-on-ground have one blank
  // row), so which screen row its content lands on depends on which tick
  // happened to be active at capture time - verified directly by dumping
  // the frame, where "▀" showed up on row 2 in one run and would land on
  // row 1 in another. Scanning the whole header band is robust to that.
  ck("the avatar is painted beside it", frame.split("\n").slice(0, 7).some(l => l.includes("▀")));

  // Fill cells the comet is touching render as "▀" (half-block) now, not a
  // shade-ramp character - a filter that only recognised the old ░▒▓█ ramp
  // would silently drop those, plus the edges (still ▓/░/▒ from the
  // directional lighting), from this count.
  const SHADE_CHARS = /[░▒▓█▀]/;
  const countLogoColours = () => {
    const s = new Set<string>();
    for (const line of captureSpans().lines.slice(0, 7)) {
      for (const span of line.spans) {
        if (SHADE_CHARS.test(span.text)) {
          const c = span.fg as any;
          s.add([c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(","));
        }
      }
    }
    return s.size;
  };

  // The wave means the logo is NOT one flat colour - but the sweep is now a
  // real Timeline tween (see app.tsx's sweepTimeline) driven by the test
  // renderer's real clock, not a hand-rolled tick, so a SINGLE fixed-delay
  // snapshot is unreliable: sampling caught it mid-cycle at moments where the
  // beam's fractional position happens to round several columns to the same
  // RGB triplet (verified by direct measurement - colour count fluctuates
  // non-monotonically frame to frame, e.g. 3,3,7,4,9,3,8 across a real
  // ~12s sweep). Sampling several checkpoints and taking the max distinguishes
  // "genuinely frozen" (every sample reads the same low count) from "animating,
  // caught one low-variety instant".
  let maxColours = 0;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 400));
    maxColours = Math.max(maxColours, countLogoColours());
  }
  ck("the logo is drawn in many colours, not one (max seen: " + maxColours + ")",
    maxColours > 3);

  // NOTE: whether the wave actually ANIMATES on screen cannot be tested here.
  // captureSpans() itself drives a render, so sampling it over time reports
  // movement even with the renderer's live mode disabled - a check written
  // that way passes whether or not the bug is present. Verified by disabling
  // requestLive() and watching the check still pass. Animation smoothness
  // needs a real terminal, like terminal-restore-on-quit.

  applyTheme("aura");
  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
