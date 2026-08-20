# Component Specs: Visual Modules

Covers the two modules behind the animated header: the logo colour wave and
the pixel avatar.

---

# 1. `src/logo.ts`

**File Path:** [src/logo.ts](../src/logo.ts)
**Role:** Renders ASCII-art logo text as a per-column cell grid so each column can be individually coloured, plus the wave and colour-blend maths.

### Functional Specification

1. **Why not `<ascii_font>`**: `ASCIIFontRenderable` accepts a `color` array, but that array is indexed by the **font's own segment index** (`colorIndex` 1 = fill, 2 = outline), **not by screen position**. Every column of a given segment type therefore receives the same colour, which makes a travelling wave impossible through that renderable. The glyphs are rendered directly instead.
2. **`logoCells(text, font): LogoCell[][]`**
   - Reads the `fonts` object exported from `@opentui/core`. Each glyph row is stored as markup, e.g. `<c1>██</c1><c2>╗</c2>`, where the tag number is that segment's colour index.
   - Parses the markup into one `LogoCell` (`{ char, colorIndex }`) per screen column, inserting `letterspace_size` blanks between glyphs.
   - Returns `[]` for an unknown font or a missing glyph, so callers can fall back rather than throw.
   - **Pads every row to the widest row.** Glyph rows are not uniform length (a letter's lower rows are often shorter); a ragged grid would place column *N* of one line above a different screen column of the next, and the wave would read as skewed rather than vertical.
3. **`wavePosition(column, phase, width = 18): number`**
   - Raised cosine, returning `0..1`: how strongly a column is lit.
   - A smooth band rather than a hard edge, travelling left to right as `phase` advances.
4. **`blend(from, to, amount): string`**
   - Linear interpolation between two `#rrggbb` colours, clamped to `0..1`.

### Consumers
- `src/app.tsx` → `paintHeader()` builds one `TextChunk` per cell and assigns a `StyledText` to the logo's `TextRenderable`.

### Contrast requirement
The wave blends **`theme.background` → `theme.accent`** (trough at 30% accent, crest at full). Blending `accentDim → accent` was tried first and is **invisible**: those two are near neighbours in every palette.

---

# 2. `src/avatar.ts`

**File Path:** [src/avatar.ts](../src/avatar.ts)
**Role:** Pixel dinosaur avatar rendered in block characters, animated beside the logo.

### Functional Specification

1. **Original artwork**: drawn in the spirit of an offline-game sprite. It is **not** a copy of Chrome's dinosaur, which is Google's artwork.
2. **`avatarFrame(name, running, tick): AvatarFrame`**, always animated, in both states:
   - **Running** (any torrent `Downloading` or `Background`): legs alternate every tick, and a 12-tick cycle lifts the sprite one row with legs tucked for two ticks, the hop.
   - **Idle**: blinks (eye pixel filled) for two ticks every 24, and shifts weight every four ticks.
   - An avatar that freezes when nothing is downloading reads as broken: a freshly opened app has no active torrents, so that was the normal case.
3. **Fixed frame height (`FRAME_HEIGHT = 7`)**: every frame is padded to the same number of rows, so the hop moves the sprite **within** its block. A variable-height block would make the entire header jitter on each jump.
4. **`avatarWidth(frame)`**: widest row, for sizing without measuring each line.

### Colour
Takes `theme.progress` (green) while running and `theme.muted` while idle, set imperatively in `paintHeader()`.

---

# 3. Render loop requirement

Both animations depend on the renderer being in **live** mode.

`CliRenderer` paints **on demand** by default: an animation loop that mutates
renderables advances in memory while the terminal stays frozen until some
other change forces a frame. `src/app.tsx` therefore calls
`renderer.requestLive()` at startup and `renderer.dropLive()` in `onCleanup`,
in addition to a `requestRender()` per painted frame.

**This cannot be verified headlessly.** `captureSpans()` itself drives a
render, so sampling frames over time reports movement whether or not live mode
is enabled: a test written that way passes with the bug present. Animation
belongs with terminal-restore-on-quit: real terminal only.
