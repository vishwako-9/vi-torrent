# termdraw — Technical Spec

| Field | Value |
|---|---|
| **System / project name** | termDRAW (termdraw-workspace, a Bun monorepo) |
| **Repository** | [benvinegar/termdraw](https://github.com/benvinegar/termdraw) |
| **Stars / Forks** | 279 / 9 (as of 2026-08-09) |
| **License** | MIT (all three published packages) |
| **Language(s) / runtime** | TypeScript throughout, Bun workspace, React (not Solid) for UI |
| **Version studied** | commit `5b6e2c9a55c53b8389a3fa26e6c05eecf91e3e4b`, 2026-05-18 (shallow clone) |
| **Direct dependencies** | `@opentui/core@0.1.97`, `@opentui/react@0.1.97` (see Compatibility below), `react@^19.2.5`; the `pi` package additionally depends on `@earendil-works/pi-*` (a separate coding-agent tool, not relevant here) |
| **Purpose (one line)** | An interactive, mouse-driven ASCII/diagram drawing editor for the terminal - not an animation or sprite-rendering library |
| **Studied on** | 2026-08-09 |
| **Local clone path** | `research/ascii-animation-study/termdraw/` (not installed) |

## What it actually is — correcting an assumption from the earlier survey

The name and description ("agent-friendly ASCII illustrator") suggested a rendering/animation
helper. Reading the actual source corrects that: `draw-state.ts` and `draw-state/` are a full
**interactive drawing editor's state machine** - tool state, pointer/mouse handling, undo/redo,
object selection and transforms, box/line geometry with elbow-corner character selection for
connecting lines. This is the terminal equivalent of a minimal Excalidraw/MS Paint, meant for a
**human to draw diagrams with a mouse in real time**, not a library of pre-built animated sprites
or a general animation engine. It's also designed to be *embedded* - the `pi` package integrates
it as an "island" inside a separate coding-agent tool (`@earendil-works/pi-coding-agent`), which
is the origin of "agent-friendly" in its description.

## Monorepo structure (3 published packages)

| Package | Role |
|---|---|
| `@termdraw/opentui` | The actual editor - `DrawState` coordinator, geometry/line helpers, React components (`TermDraw`, `TermDrawApp`, `TermDrawEditor`) that register as opentui renderables via `extend()` |
| `@termdraw/app` | Standalone CLI (`termdraw` bin) wrapping the above into a runnable terminal app |
| `@termdraw/pi` | Embeds the editor inside the separate "Pi" coding-agent tool via `opentui-island` |

## Compatibility with vi-torrent — two real mismatches

1. **React, not Solid.** `@termdraw/opentui`'s public API (`react.ts`) is built on `@opentui/react`
   and registers components via `extend()` from that package. vi-torrent is `@opentui/solid`.
   These are different binding layers over the same Zig core - termdraw's React components can't
   be dropped into a Solid app without either running React alongside Solid (messy, two UI
   runtimes in one process) or reimplementing the relevant logic against Solid's API.
2. **Old core version.** Pinned to `@opentui/core@0.1.97`; vi-torrent runs `^0.4.5`. That's a large
   version gap on a library still under active pre-1.0 development - the low-level renderable API
   surface may well have changed between them. Any ported logic would need re-verifying against
   the current core API, not assumed compatible.

**Net: not a drop-in dependency for vi-torrent** (confirms the license/version-appropriate caution
already flagged in the earlier survey, now with the concrete reasons).

## What's genuinely worth taking, despite the above

### `startup-logo.ts` — a static gradient technique, no animation at all

The app's splash screen (`renderStartupLogo()`) is instructive precisely because it's **not**
animated - no tick, no time input, computed once from `(rowIndex, colIndex)` alone:

- **Vertical gradient across the whole logo**: rows 0-55% blend `dim → accent`, rows 55-100%
  blend `accent → warning` - a two-stop gradient down the logo's height, not a single flat tint.
- **Horizontal "highlight" layered on top**: `0.1 + 0.16 * sin(horizontalT * π)` - a sine curve
  peaking at the row's horizontal center, mixed toward `theme.text`. This puts a subtle brightening
  in the middle of each line, tapering at both edges - reads as a soft light source, using only
  static per-cell math, no frame loop.
- Same `mixColor()` as vi-torrent's `blend()` - linear RGB, not cfonts' HSV-radial approach
  (see the cfonts spec) - so this doesn't demonstrate a better interpolation, just a different
  application of the same one.

**Relevant to vi-torrent**: this is a genuinely different design idea from the sweep animation -
a *static* multi-axis gradient (vertical colour ramp + horizontal sine highlight) can look
dimensional and deliberate without any animation cost at all. Worth considering as an alternative
or a complement to the sweep, especially for contexts where animation is disabled
(`animations_enabled` false, matching codemie's own static fallback).

### `draw-state/line.ts` — elbow/corner character selection

Has real logic for picking the correct box-drawing corner/elbow character (`┌┐└┘├┤┬┴┼`) based on
which directions a line connects in - a proper implementation of the "which corner glyph" problem.
Not needed for the current avatar/logo work, but relevant if vi-torrent ever draws connector lines
or diagrams (e.g. a peer-connection map) rather than just text and borders.

## Synthesis — what's actually usable for vi-torrent

1. **Not a dependency** - React-vs-Solid and the opentui-core version gap both rule out direct
   reuse of `@termdraw/opentui`'s components.
2. **`startup-logo.ts`'s two-axis static gradient technique is worth porting as an idea**
   (re-implemented in vi-torrent's own code, using its own `blend()`) - a legitimate alternative
   to animation for a "looks intentional, costs nothing per frame" effect.
3. **Not useful for the avatar specifically** - this is a diagramming tool, not a sprite/animation
   library; nothing here helps with "make the avatar 3D."
