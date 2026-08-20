# Pre-codemie theme & animation replacement

Removed from `src/theme.ts` and `src/logo.ts` on 2026-08-09, when vi-torrent's
12 hand-authored themes and continuous two-hue logo wave were replaced
wholesale with 33 themes ported from
[codemie-opencode](https://github.com/codemie-ai/codemie-opencode) and a
sweep-once-then-pause animation matching its style (see
`THIRD-PARTY-NOTICES.md` for the attribution, and `scripts/gen-themes.mjs`
for the port script). Kept here rather than only in git history so the old
design is easy to glance at, or revert to, without `git show`.

Not wired into the build - neither file is imported anywhere, and
`tests/run-all.ts` only globs `src`-sibling `tests/test-*.ts(x)`, which does
not reach into `archive/`.

## Contents

- `src/theme-old-12.ts` - the old `THEMES` array, all 12 palettes, including
  the Claude-branded default (`"claude"` - terracotta, matched to Claude
  Code's own accent colour since Claude Code itself stores no theme to read
  from).
- `src/logo-old-wave.ts` - the old `wavePosition()`, a raised-cosine wave
  blended continuously between `theme.accent` and `theme.accent2`, with no
  pause - an ambient pulse rather than the current punctuated glint.

## Why the replacement happened

Track record, not preference: two prior web-frontend attempts by this
project's author (Antigravity Trading Dashboard, and the ai-dashboard bridge
UI built with Stitch) both accumulated hard-to-fix bugs over weeks, while
vi-torrent's TUI (opentui/Bun stack) reached a clean, stable state through
step-by-step easy fixes. codemie-opencode's theme roster and logo animation
were adopted as the reference.

## Known, disclosed tradeoff carried into the new roster

9 of the 33 ported themes (mercury, vercel, lucent-orng, orng, cursor,
carbonfox, nord, aura, solarized) have an `accent`/`accent2` pair too close in
hue to read as two distinct colours - a rule the OLD 12-theme roster enforced
as a hard test (`every theme has a second, genuinely different hue`, only
`mono` exempted). The new roster takes codemie-opencode's palettes as
faithfully as its own schema allows rather than re-tuning them to that rule;
the test is now an informational log (`tests/test-visuals.tsx`), not a hard
failure. Accepted deliberately, not an oversight - see that test file's
comment for the exact themes affected.
