# cfonts — Technical Spec

| Field | Value |
|---|---|
| **System / project name** | cfonts |
| **Repository** | [dominikwilkowski/cfonts](https://github.com/dominikwilkowski/cfonts) |
| **Stars / Forks** | 1,883 / 67 (as of 2026-08-09) |
| **License** | GPL-3.0-or-later (see Licensing section — study only, never a dependency) |
| **Language(s) / runtime** | Two independent implementations in one repo: **Rust** (`cfonts` crate, v1.3.0, edition 2021) and **Node.js** (plain CommonJS `.js`, no TypeScript, no build step) |
| **Version studied** | commit `1fd8919b782cb8d0980b7b5845ad3fc670e42fba`, 2025-10-17 (shallow clone, `--depth 1`, so this is the tip at clone time, not a full history) |
| **Direct dependencies (Node.js)** | `supports-color@^8`, `window-size@^1` — that's the entire runtime dependency list |
| **Direct dependencies (Rust)** | `exitcode`, `strum`/`strum_macros`, `serde`/`serde_json`, `rand`, `terminal_size`, `supports-color`; Windows-only: `enable-ansi-support` |
| **Purpose (one line)** | Render a text string as big, optionally coloured/gradient ASCII-art letters to stdout — a CLI banner tool, not a library meant to be embedded in another app's render loop |
| **Studied on** | 2026-08-09 — this doc is a point-in-time read of the commit above; re-verify against current `main` before relying on specifics if much time has passed |
| **Local clone path** | `research/ascii-animation-study/cfonts/` (not installed — no `bun install`/`npm install` run against it) |

Source: `research/ascii-animation-study/cfonts` (dominikwilkowski/cfonts, 1,883★, GPL-3.0,
shallow-cloned 2026-08-09 for study only — **never add as a dependency**, see Licensing below).

## What it actually is

A CLI tool that renders a text string as big ASCII-art letters, with color/gradient support.
"Sexy fonts for the console." It is **not** an animation library — there is no frame concept,
no tick loop, no motion of any kind anywhere in the codebase (confirmed: grepped the whole
`nodejs/src/` tree for `animat|frame|tick|interval`, zero hits). It renders once, to stdout,
and exits. Two independent implementations ship in one repo — Rust (`rust/`) and Node.js
(`nodejs/`) — both consuming the same font data.

**This is the actual, confirmed source of vi-torrent's current logo font.** `fonts/block.json`
in this repo is byte-identical to the font data bundled inside `@opentui/core`'s
`chunk-bun-t2myhmwd.js`, which `src/logo.ts`'s `logoCells()` reads via opentui's `fonts` export.
Opentui vendored the font *data* (JSON), not this GPL code.

## Font data format

Each font is one JSON file in `fonts/`. Schema, from `block.json`:

```json
{
  "name": "block",
  "version": "0.2.0",
  "colors": 2,
  "lines": 6,
  "buffer": ["", "", "", "", "", ""],
  "letterspace": [" ", " ", " ", " ", " ", " "],
  "letterspace_size": 1,
  "chars": {
    "A": [
      " <c1>█████</c1><c2>╗</c2> ",
      "<c1>██</c1><c2>╔══</c2><c1>██</c1><c2>╗</c2>",
      "..."
    ]
  }
}
```

- `lines` — how many text rows tall one glyph is.
- `colors` — how many distinct `<cN>` colour-role tags the font uses (2 for `block`: fill +
  outline; some fonts use 3, `console`/`simple`/`simple3d`/`simpleBlock` use 1 — no colour
  markup at all, plain characters).
- `chars[letter]` — an array of `lines` strings, each markup like `<c1>██</c1><c2>╗</c2>`.
  This is exactly what `src/logo.ts`'s `parseRow()` regex-parses into per-character
  `{char, colorIndex}` cells — confirmed 1:1 match with vi-torrent's own consumption code.
- `letterspace_size` — columns of gap inserted between letters (vi-torrent reads this too).

## The 13 font styles (only 2 are in opentui/vi-torrent today)

Surveyed all 13 (`node -e` dump of each, letter A):

| Font | Lines | Colours | Character | In opentui? |
|---|---|---|---|---|
| `block` | 6 | 2 | Full-block fill + box-drawing outline | **Yes** — vi-torrent's `logoFont()` "block" |
| `tiny` | ~3 | 2 | Compact block variant | **Yes** — "tiny" (narrow-terminal fallback) |
| `3d` | 9 | 2 | `/\\\` slash-art, genuine slanted 3D-perspective letterforms | No |
| `shade` | 8 | 2 | Mixes `░` (light shade) with `█` (solid) for a soft/textured edge | No |
| `chrome` | 3 | **3** | Box-drawing, 3 colour roles (only font with 3) | No |
| `huge` | 11 | 2 | `▄▀░█` mix, very large, rounded via shade characters | No |
| `grid` | 6 | 2 | `┏┓┃╋` box-drawing, grid/circuit-board look | No |
| `pallet` | 6 | 2 | `╔═╗` box-drawing, ornate/bordered | No |
| `slick` | 6 | 2 | `╭╮╯╰` rounded box-drawing | No |
| `simple` | 4 | 1 | Thin ASCII (`/_\`), no colour markup | No |
| `simple3d` | 7 | 1 | Thin ASCII with a 3D lean, no colour markup | No |
| `simpleBlock` | 7 | 1 | Underscore/pipe blocky, no colour markup | No |
| `console` | 1 | 1 | Passthrough — literally just the character | No |

**Directly relevant to tonight's "make it 3D" ask**: `3d.json` is a genuine, already-authored
ASCII 3D-perspective font (demoscene-style slash-art), and `shade.json` already solves
"soft/textured edge" with density characters instead of a flat colour block. Both are drop-in
replacements for `logoFont()`'s font name (opentui's `fonts` export would need these added
first — they're not currently bundled, only `block`/`tiny` are). Cheapest possible way to
explore a different visual direction: point `logoCells()` at a different *font name*, no new
rendering logic.

## Render pipeline (Node.js implementation, `nodejs/src/`)

One-shot pipeline, no state kept between calls:

`ParseArgs` → `Options` → `CheckInput`/`CleanInput` → `GetFont` (loads the JSON) →
`AddChar` (glyph lookup per character) → `AddLine`/`AddLetterSpacing` (assembly) →
`AlignText` → `Colorize`/`Gradient`/`Color` (apply colour) → `Render` (final string) → `Say`
(print). `Debugging.js` is a verbose-mode tracer, not part of normal operation.

### `Gradient.js` — worth learning from, independent of the rest

This is the one module with real technical substance beyond "look up a glyph." It interpolates
colour along an **HSV radial path** (`Hex2hsvRad` → `GetTheta` → `HsvRad2hex`), not linear RGB.
`GetTheta` walks the shorter arc around the hue wheel (handles wraparound explicitly, picking
whichever direction — clockwise or counter-clockwise — covers less angular distance). This
matters because **linear RGB interpolation between two saturated colours passes through a dull,
desaturated colour** (e.g. red→green linearly muddies through brown/olive at the midpoint);
hue-rotation stays vivid the whole transition.

**Directly relevant**: vi-torrent's own `blend()` (`src/logo.ts`) is linear RGB
(`mix(r1,r2,amount)` per channel) — the same category of interpolation cfonts moved *away*
from for exactly this reason. Tonight's wave/shadow work never hit visibly muddy midpoints
because the transitions used so far (theme.text↔theme.accent, background↔accent) usually
have one low-saturation endpoint (text is often near-white/near-black), which linear RGB
handles fine. It would start to matter if a future change blends between two *both-saturated*
hues (e.g. a direct accent↔accent2 sweep, which the very first wave version tried and
abandoned for other reasons) — worth revisiting `GetTheta`'s approach if that comes back.

## Licensing — why this stays study-only

Root `LICENSE` is **GNU GPL-3.0-or-later**. vi-torrent is MIT (see its own
`THIRD-PARTY-NOTICES.md`). Adding cfonts as an npm dependency would pull GPL-3.0 obligations
into an MIT project. This is exactly the situation opentui itself navigated: it uses the font
*data* (JSON is not code, and simple glyph-shape data is unlikely to carry the same copyright
weight as the render pipeline code around it) inside its own MIT codebase, without depending on
the GPL package. Same move here: read for technique, copy no code, never `bun add cfonts`.

## Synthesis — what's actually usable for vi-torrent

1. **Two more font styles, zero new code**: `3d` and `shade` are already-authored, ready-to-use
   glyph data for exactly the aesthetic directions raised tonight (3D letterforms, soft-edge
   shading). Getting them into vi-torrent means adding their JSON to whatever `fonts` source
   `logoCells()` reads from (currently opentui's bundle only has `block`/`tiny` — would need
   vendoring these two font JSONs into vi-torrent directly, same "data not code" move as
   opentui made, since the font JSON itself is just glyph-shape data).
2. **HSV radial interpolation** is a real upgrade path for `blend()` if a future wave/shadow
   design ever blends two saturated hues directly against each other.
3. **No animation technique to learn here** — cfonts confirms, by absence, that vi-torrent's
   own `sweepIntensity()`/`paintHeader()` approach (animation layered on top of static font
   data) is the correct architecture; there's no "cfonts animation system" to have missed.
