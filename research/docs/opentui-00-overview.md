# OpenTUI Internals — Reading Guide

| Field | Value |
|---|---|
| **System / project name** | OpenTUI (`@opentui/core` + `@opentui/solid`) |
| **Repository** | [anomalyco/opentui](https://github.com/anomalyco/opentui) |
| **Stars / Forks** | 12,930 / 679 (as of 2026-08-09) |
| **License** | MIT |
| **Language(s) / runtime** | Zig (rendering core, native binary via FFI) + TypeScript (bindings/renderables) + SolidJS (reconciler package); requires Bun (Node's `node:ffi` path doesn't exist) |
| **Version studied (docs 01-10, original pass)** | `@opentui/core`/`@opentui/solid` **0.4.5** - matches vi-torrent's own pinned `^0.4.5` |
| **Version at this re-check (2026-08-09)** | **0.5.1**, commit `de64d210e4f0163720fc1fbfa838d4d1aad47d53` - upstream has moved since docs 01-10 were written; treat any 0.4.5→0.5.1 API delta as unverified until re-checked, same caution this doc already applies to the 0.1.79 codemie-opencode gap below |
| **Purpose (one line)** | The terminal-UI rendering framework vi-torrent itself is built on - not a new external tool, this is what's already running |
| **Studied on** | Docs 01-10: earlier session (pre-dates this doc's original writing). This header + doc 11: 2026-08-09 |
| **Local clone path (this pass)** | `research/ascii-animation-study/opentui/` (0.5.1) - original docs 01-10 read from a separate, older `research/opentui-src/` clone (0.4.5), not the same directory |

This is the one repo in the ASCII-animation-study set that was **already extensively documented**
before tonight (docs 01-10 below, from earlier work on the daemon-first rewrite). Re-studied
tonight only for the one genuine gap relevant to animation specifically - see
**[opentui-11-animation-timeline.md](opentui-11-animation-timeline.md)**, a real first-class
tweening engine (`Timeline`, easing functions, `useTimeline()`) that existed in the source all
along but wasn't covered by docs 01-10, and that vi-torrent's own hand-rolled sweep animation
does not currently use.

Ten component docs, read from the real opentui source (`research/opentui-src/packages/`), written for someone about to rebuild a Python + Textual BitTorrent client (`torrent-tui`) as a Node.js/TypeScript app on `@opentui/core` (+ optionally `@opentui/solid`). Suggested reading order below (numbering matches filenames). Companion doc set: `research/../../torrent-tui/research/docs/` covers the aria2/libtorrent side of the same rebuild.

1. **[opentui-01-rendering-core.md](opentui-01-rendering-core.md)** — `CliRenderer`/`createCliRenderer()` (the app bootstrap and render loop), the `Renderable` base class every widget extends, `OptimizedBuffer` (the cell-grid drawing surface), and the full `@opentui/core` public export list from `index.ts`.
2. **[opentui-02-layout-engine.md](opentui-02-layout-engine.md)** — the native-Zig-hosted Yoga flexbox binding (`yoga.ts`) and shared cross-cutting types (`types.ts`, notably `RenderContext` and `TextAttributes`); this is opentui's equivalent of Textual's CSS layout system.
3. **[opentui-03-text-rendering.md](opentui-03-text-rendering.md)** — `TextBuffer`/`TextBufferView` (display text, wrap/scroll/selection/highlights), `TextBufferRenderable` (the base every text-displaying widget extends), and `EditBuffer`/`EditorView` (the editable counterpart backing input widgets).
4. **[opentui-04-renderables-basic.md](opentui-04-renderables-basic.md)** — `Box` (bordered/filled container), `Text`/`TextNode` (styled text with nested spans), `FrameBuffer` (raw pixel-canvas escape hatch), and the full widget-registration barrel (`renderables/index.ts`).
5. **[opentui-05-renderables-input.md](opentui-05-renderables-input.md)** — `Input`/`Textarea` (text entry), `Select`/`TabSelect` (option lists), `Slider` (numeric drag control) — the focusable/interactive widget set.
6. **[opentui-06-renderables-data.md](opentui-06-renderables-data.md)** — `TextTable` (real data-grid widget, directly relevant to our torrent list), `ScrollBox`/`ScrollBar` (scrollable viewport with virtualized/culled children).
7. **[opentui-07-renderables-rich-content.md](opentui-07-renderables-rich-content.md)** — `Markdown`, `Code` (tree-sitter syntax highlighting), `Diff`, `ASCIIFont` (big block-letter text — relevant to a "big logo" header), `LineNumberRenderable`.
8. **[opentui-08-terminal-io.md](opentui-08-terminal-io.md)** — raw ANSI constants, the in-app debug console overlay, and the platform/runtime abstraction that requires the Bun runtime (confirms genuine win32 native-binary support, though Node is broken).
9. **[opentui-09-plugins-and-runtime.md](opentui-09-plugins-and-runtime.md)** — a Bun-bundler-specific plugin-module-sharing mechanism plus a generic slot-based UI-extension registry; mostly background knowledge, not on our critical path.
10. **[opentui-10-solid-reconciler.md](opentui-10-solid-reconciler.md)** — the separate `@opentui/solid` package: a SolidJS universal-renderer wiring JSX (`<box>`, `<text>`, ...) onto the `Renderable` tree. Notes the real 0.4.5 (this clone) vs. 0.1.79 (codemie-opencode's actual dependency) version gap.
11. **[opentui-11-animation-timeline.md](opentui-11-animation-timeline.md)** — `Timeline`/`JSAnimation` (`packages/core/src/animation/Timeline.ts`): a real anime.js-style tweening engine with proper easing curves, attached to the renderer's own loop, exposed to Solid via `useTimeline()`. Not covered by docs 01-10; added 2026-08-09 specifically for the animation-technique research. vi-torrent's own logo sweep does not use this.

## Getting started (grounded in the real source/README/package.json, not guessed)

**Imperative (`@opentui/core` alone), from `packages/core/README.md`:**
```typescript
import { createCliRenderer, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()
const obj = new TextRenderable(renderer, { id: "my-obj", content: "Hello, world!" })
renderer.root.add(obj)
```
`createCliRenderer(config?)` (doc 01) reads terminal dimensions, constructs a `CliRenderer`, and awaits `setupTerminal()` (raw mode, capability queries). `renderer.root` is a `RootRenderable` — the mount point for the whole tree. Every widget's first constructor argument is a `RenderContext` (the renderer satisfies this interface itself), second is its options object.

**JSX/SolidJS (`@opentui/solid`), from `packages/solid/README.md` + `packages/solid/index.ts` (doc 10):**
1. `tsconfig.json`: `"jsx": "preserve"`, `"jsxImportSource": "@opentui/solid"`.
2. `bunfig.toml`: `preload = ["@opentui/solid/preload"]`.
3. Entry point:
   ```tsx
   import { render } from "@opentui/solid"
   render(() => <text>Hello, World!</text>)
   ```
4. Run with `bun index.tsx`; build for distribution with `Bun.build` + `@opentui/solid/bun-plugin`.

`render()` internally calls `createCliRenderer()` (unless you pass an existing `CliRenderer`), attaches Solid's animation engine, wraps your root component in a `RendererContext.Provider`, and mounts it onto `renderer.root` via Solid's own reconciler (`_render` from `reconciler.ts`) — same underlying `CliRenderer`/`RootRenderable` foundation as the imperative path, just driven by Solid's JSX compiler output instead of manual `.add()` calls.

No standalone runnable example was found under `packages/examples/` beyond an `install.sh` for prebuilt release binaries and a `src/` folder not read in this pass (the working getting-started snippets above come straight from `packages/core/README.md` and `packages/solid/README.md`, both fully read). `packages/core/docs/` contains only `development.md` (build/test/contributing instructions, not API docs) — the fuller docs referenced from the README (`opentui.com/docs/...`) are hosted externally and were not fetched for this pass.

## Files that didn't exist or were empty
None of the files named in the task brief were missing — every listed path in groups 1-10 existed and had real content. One naming note: the brief calls out "TextBufferRenderable equivalent in renderables/TextBufferRenderable.ts" — this is exactly that file (`TextBufferRenderable` is the actual exported class name, not a stand-in).

## Genuinely surprising / version-inconsistent findings
- **Solid package version gap is real and current**: this clone is `@opentui/core`/`@opentui/solid` 0.4.5; `codemie-opencode-src`'s `packages/opencode/package.json` pins both at 0.1.79. Spot-checking codemie's actual `.tsx` files shows the same lowercase JSX tag vocabulary (`<box>`, `<text>`, `<span>`) and the same hook/import names (`render`, `useKeyboard`, `useRenderer`, `useTerminalDimensions`) still in use — so the core authoring model looks stable across the gap, but no CHANGELOG diff was done; treat 0.4.5-only APIs as unverified against 0.1.79 until checked.
- **`TextTableRenderable` and `SliderRenderable` have no JSX tag** in `@opentui/solid`'s component catalogue (`packages/solid/src/elements/catalogue.ts`), despite both being real, exported `@opentui/core` renderables. Using our torrent table from Solid JSX requires an explicit `extend({ table: TextTableRenderable })` call rather than a tag opentui ships out of the box — worth deciding on early since the table is our single most important widget.
- **Native FFI support requires Bun**: `platform/ffi.ts` defines real, separate Bun (`bun:ffi`, numeric pointers) and Node (bigint pointers) backend shapes, selected via a `package.json#imports` conditional map. However, the Node backend relies on `node:ffi` which does not exist, silently causing failure. Thus, the framework requires Bun to execute the native rendering pipeline. The `win32-x64`/`win32-arm64` native binaries (`opentui.dll` via `@opentui/core-win32-x64`) are first-class targets alongside darwin/linux, but you must use `bun run` (not Node) on Windows.
- **`TextTable` has no incremental row/cell update API** (no `add_row`/`update_cell` equivalent to Textual's `DataTable`) — updates go through reassigning the whole `.content` matrix, which may mean our `refresh_table()` loop moves from Textual's current diff-based approach to a full-rebuild-per-tick approach. This is inferred from the static source (no incremental method found) and should be validated against a running example, not treated as fully certain.
- **`ASCIIFontRenderable` already exists and is ready-made** for the "big logo" idea floated earlier — it auto-measures and auto-renders block/ASCII-art text into its own `FrameBuffer`, no custom pixel-drawing code needed.
