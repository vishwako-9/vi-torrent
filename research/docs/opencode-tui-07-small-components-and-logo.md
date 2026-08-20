# Small Components and Logo

## Purpose
Four small, single-purpose presentational components: a border-style constant, the animated startup logo, a spinner wrapper, a rotating tips line, and a todo checklist row. None hold significant state; they're the kind of leaf components every screen composes from.

## Key files
- `component/border.tsx` — `EmptyBorder`/`SplitBorder`: shared border-character constants (no full box border, just left/right verticals with a specific glyph).
- `component/logo.tsx` — `Logo`: the animated startup wordmark, reading raw ASCII-art strings from `@/cli/logo.ts`.
- `component/spinner.tsx` — `Spinner`: wraps the `opentui-spinner` widget with theme-aware color and an animations-disabled fallback (`⋯`).
- `component/tips.tsx` — `Tips`: picks one random tip from a ~90-entry list, with `{highlight}...{/highlight}` inline markup parsed into styled spans.
- `component/todo-item.tsx` — `TodoItem`: one checklist row (`[ ]`/`[•]`/`[✓]`), colored by status.

## How it works
**The logo is real multi-line block-character ASCII art, not a single-line wordmark** — this directly answers the "do opencode-style tools use big logos" question. The actual glyph data lives outside the `tui/` folder entirely, in `src/cli/logo.ts`:
```
"                           ▄       ",
"█▀▀▀ █▀▀█ █▀▀▄ █▀▀█ █▄_▄█ _▀▀_ █▀▀█",
"█___ █__█ █__█ █^^^ █_▀_█ _██_ █^^^",
"▀▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀▀ ▀___▀ _▀▀_ ▀▀▀▀",
```
Four lines tall, built from Unicode block-drawing characters (`█▀▄`), spelling codemie's product name in a blocky pseudo-3D style. Three placeholder characters (`_^~`, exported as `marks`) aren't literal glyphs — they're **shadow markers** post-processed at render time: `_` becomes a space with a tinted background (bottom-shadow of a block), `^` becomes a `▀` with tinted background, `~` becomes a dim-foreground `▀` — this is how the flat ASCII data gets a subtle drop-shadow/bevel look without needing a richer format. `component/logo.tsx` reads this raw string array and renders it two ways: a static fallback (`renderLineStatic`, used when `kv.get("animations_enabled")` is false) that just applies the shadow-marker substitution once, and an **animated** default where every character is measured (`lineChars`) and a `setInterval(70ms)` advances a `frame` counter driving a left-to-right "sweep" highlight — each character's foreground color is `tint(theme.text, theme.primary, intensity)` where `intensity` falls off over a `SWEEP_WIDTH = 6`-character-wide band centered on the current frame position, so a bright color band visibly scans across the logo once every `logoWidth + SWEEP_WIDTH + PAUSE_FRAMES` frames, then pauses (`PAUSE_FRAMES = 20`) before repeating. All logo glyphs are marked `selectable={false}` so mouse text-selection skips over decorative art.

`border.tsx` defines two shared constants rather than a component: `EmptyBorder` zeroes out every border-character slot except `horizontal: " "` (used as a base to spread-override), and `SplitBorder` (`{border: ["left","right"], customBorderChars: {...EmptyBorder, vertical: "┃"}}`) is the "just a left accent bar" look used pervasively for message blocks, tool output blocks, and prompt panels throughout the session screen — notably, it's a **left/right split border with only the vertical character set**, not a full box; the "border" most of the app shows is really just a single colored vertical bar on one or both sides.

`Spinner` is a thin wrapper: if animations are enabled it renders the actual `<spinner frames={...} interval={80}>` custom element (registered globally via the side-effecting `import "opentui-spinner/solid"`), using a hardcoded 10-frame braille-dot cycle (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) unless a caller supplies its own `frames`/`color`; if animations are disabled, it falls back to a static `⋯` glyph plus children text — every animated element in the app respects this same `animations_enabled` KV flag and provides a static fallback, not just the logo.

`Tips` does simple inline markup parsing: a regex (`/\{highlight\}(.*?)\{\/highlight\}/g`) splits a tip string into `{text, highlight: boolean}` segments, rendered as styled `<span>`s (highlighted = normal text color, non-highlighted = muted). The tip list itself is a flat ~90-line array of feature hints (keybindings, config options, CLI flags), one picked at random per mount — no rotation timer, it's fixed for the component's lifetime.

`TodoItem` is the simplest file in the group: a single row, `[ ]`/`[•]`/`[✓]` bracket-status prefix plus word-wrapped content text, colored amber while `in_progress` and muted otherwise.

## Relevance to our torrent client rebuild
On the specific "big logo" question the user is weighing: opencode's answer is **yes, a real multi-line ASCII-art block logo**, but it's small (4 lines, ~36 columns) and most of its visual interest comes from the animated sweep + shadow-marker bevel effect, not from raw size — a plain static 4-line block logo would look comparatively flat. If we want a comparable "polished startup screen" feel for our home/landing view, budget for the same three things together: (1) a compact block-art wordmark (a torrent-themed glyph or just "VITORRENT" in block characters), (2) an `animations_enabled`-gated sweep effect using the same `tint()`-based color interpolation, and (3) a static fallback for when animations are off — not just the raw ASCII, since raw ASCII alone reads noticeably plainer in their own codebase. `border.tsx`'s `SplitBorder` (left/right vertical-only accent) is directly reusable as the border style for our torrent-list rows or a detail panel, cheaper visually than a full box border and easy to color per-status (seeding=green bar, error=red bar). `Spinner`'s enabled/disabled dual-path is worth copying outright for our own busy-indicators (checking tracker, hashing files) — respecting a user's reduced-motion/no-animation preference for free. `Tips`' random-tip-with-inline-highlight-markup is a nice, cheap addition to an empty torrent-list state ("Tip: press `/` to add a magnet link").
