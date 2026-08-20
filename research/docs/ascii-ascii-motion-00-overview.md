# Ascii-Motion — Technical Spec

| Field | Value |
|---|---|
| **System / project name** | ASCII Motion |
| **Repository** | [CameronFoxly/Ascii-Motion](https://github.com/CameronFoxly/Ascii-Motion) |
| **Stars / Forks** | 845 / 52 (as of 2026-08-09) |
| **License** | **Split, not uniform** — see Licensing below, this is the important finding |
| **Language(s) / runtime** | TypeScript, React 19, Vite; monorepo (npm workspaces) |
| **Version studied** | commit `9828229fe9becbde7f021f12a3b70f485e1ed65f`, 2026-07-08; app version `2.1.8` |
| **Direct dependencies (`packages/core`, the only MIT part)** | Radix UI primitives, `figlet`, `opentype.js`, `simplex-noise`, `zustand`, `tailwind-merge` - all shadcn/ui-style component plumbing, not animation logic |
| **Purpose (one line)** | A full commercial web app (ascii-motion.app) for drawing and animating ASCII art, with an export system that can output OpenTUI/Ink/BubbleTea-ready code |
| **Studied on** | 2026-08-09 |
| **Local clone path** | `research/ascii-animation-study/Ascii-Motion/` (not installed) |

## Scale correction from the earlier survey

The initial search summary undersold this: it's not a small tool, it's a full commercial product -
Supabase backend, Vercel deployment, an MCP server, a marketing site, a docs site, a premium tier,
100+ planning/implementation docs in `docs/`. Worth knowing before assuming "quick to read."

## Licensing — the critical finding, checked directly, not assumed

Two license files at the repo root:

- `LICENSE-MIT` — standard MIT, Copyright ASCII Motion.
- `LICENSE-PREMIUM` — proprietary, "all rights reserved," and **explicitly scoped** in its own
  text: *"This license applies ONLY to: `packages/premium/`, `packages/web/`, and any files
  marked `@license Proprietary`."*

Checked `packages/core/package.json` directly (`"license": "MIT"`) to confirm which package that
covers - and it's **not the animation engine**. `packages/core` is `@ascii-motion/core`,
described in its own `package.json` as *"Shared UI component library (shadcn/ui components)"* -
generic dialog/button/tab/slider widgets for the app's own interface. The actual drawing/animation
engine, the export system, and the OpenTUI/Ink/BubbleTea generators all live in `packages/web`,
which is the **proprietary** package. The repo's own `scripts/check-licenses.js` enforces this
split by scanning for `@license MIT` vs `@license Proprietary` header comments per directory - so
this isn't a loose convention, it's a tooling-enforced boundary the maintainers actively police.

**What this means in practice**: the source code of the actual editor and export generators is
not open - only generic UI widgets are. This does **not** block the intended use case, though:

## Why the recommended use is still completely safe

The plan all along was "use the hosted web app to design/export, never install any of its code as
a dependency." Using a website to produce your own exported data doesn't require a license to that
website's source code, proprietary or not - same as using Photoshop to export a PNG doesn't require
a license to Photoshop's source. `packages/web` being proprietary changes nothing about that plan.
It does rule out one thing: don't clone parts of `packages/web` into vi-torrent even for reference/
inspiration beyond understanding the *data format* - that crosses from "using the tool" into "using
the proprietary code."

## The OpenTUI export format — confirmed against a real generated example

`docs/OPENTUI_COMPONENT_EXPORT_IMPLEMENTATION_PLAN.md` (status: COMPLETED) describes the format;
`dev-tools/opentui-test-cli/src/fish-animation.tsx` is a real, checked-in generated example that
matches the plan exactly:

```typescript
type FrameData = {
  duration: number;                   // ms, can vary per frame
  content: string[];                  // one string per row
  fgColors: Record<string, string>;   // "row,col" (or similar key) -> palette ref
  bgColors: Record<string, string>;
};

const COLORS_DARK: Record<string, string> = { c0: '#c2f261', c1: '#91f291', /* ... */ };
const COLORS_LIGHT: Record<string, string> = { c0: '#3a491d', /* ... */ };  // same keys, dimmed
const FRAMES: FrameData[] = [ { duration: 100, content: [ /* 60+ char rows */ ], fgColors: {...}, bgColors: {...} }, /* ... */ ];
```

Design choices worth noting:
- **`setInterval`, not opentui's `useTimeline`** - deliberate, per the plan doc: `useTimeline` is
  for continuous tweening, this needs discrete frame-switching with a *variable* duration per
  frame (their example uses 100ms uniformly, but the field supports per-frame timing).
- **Palette indirection** (`c0`..`cN` keys resolved through a theme dict) rather than inline hex
  per cell - one place to retheme the whole animation for dark vs. light backgrounds.
- **The generated wrapper is React** (`useState`/`useEffect`/`useRef`, `@opentui/react` JSX) -
  same incompatibility as termdraw, vi-torrent is Solid. **The `FRAMES` array itself is plain
  data with zero React dependency** - the actual portable part.

## Synthesis — what's actually usable for vi-torrent

1. **Use the hosted app directly** (ascii-motion.app) to design richer avatar frames - safe
   regardless of the proprietary backend, per the Photoshop analogy above.
2. **Export as "OpenTUI Component," discard everything except the `FRAMES` array and the colour
   theme dicts.** Don't use the generated `.tsx` wrapper (React, and structurally different from
   how `avatar.ts` already works) - port the plain data into vi-torrent's existing
   `avatarFrame(name, running, tick)` pattern instead, which already expects `string[]` frames.
3. **The palette-indirection idea (theme-dict keys instead of inline hex) is worth adopting**
   regardless of where the frame data comes from - it's how you'd make a hand-authored avatar
   re-themeable across vi-torrent's 33 themes without hardcoding colours into the frame strings.
4. **Do not clone or reference `packages/web` code** beyond the export-format understanding
   already captured above - that package is proprietary, and there's nothing in it needed beyond
   the format, which is now fully documented here.
