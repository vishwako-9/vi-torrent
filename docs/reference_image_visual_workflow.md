# From Reference Image to Terminal Art: the Shading/Avatar/Logo Workflow

How the avatar (`src/avatar.ts` + `src/shading.ts`) and the logo
(`src/logo.ts` + the paint block in `src/app.tsx`) were actually built,
2026-08-09, written down as a repeatable recipe rather than a session
diary. Every technique below was derived from a real reference image the
user supplied or generated, checked against that image, and only then
turned into code, never invented from a general idea of "shading" and
hoped to look right.

The goal of writing this down: a future version of this workflow (a
skill, a `/loop`, whatever shape it takes) needs the actual DECISION
PROCESS, not just the final formulas. This doc is that process.

---

## 1. The two kinds of reference image, and why they lead to different code

Every reference image used this session fell into exactly one of two
categories, and the category decided which technique applied. Conflating
them is the most likely way a future automated version of this gets it
wrong.

| Category | What the image shows | What it answers | Technique it leads to |
| :--- | :--- | :--- | :--- |
| **Rounded / organic surface** | A creature, a curved body part, continuous curvature, no flat faces | "Which direction is the surface curving, and how does light fall across a curve?" | **Lambertian lighting from a `Lobe`** (`shading.ts`), brightness computed from geometry |
| **Faceted / extruded surface** | 3D block letters, a beveled logo, flat faces meeting at hard edges | "Which flat FACE is this cell part of, and which way does that face point?" | **Directional edge classification by neighbour** (`app.tsx`'s logo paint block), brightness looked up from a small fixed table, not computed |

The tell: does the reference show a smooth gradient across a surface (use
Lambert), or does it show 2–4 distinct, evenly-lit flat regions meeting at
sharp lines (use directional classification)? The dino's head is round,
Lambert. The "TORRENT" letters are extruded blocks with a top, a front,
and a side, directional classification. Using Lambert on the logo would
have produced a smooth gradient across a letter that should read as flat
faces; using directional classification on the dino would have produced
banding on what should be a smooth curve. Picking the wrong one is a
plausible-looking mistake, not an obviously broken one, it renders,
just wrong.

A third category, **motion trails** (the comet-tail sweep), isn't
lighting at all and is covered separately in §4.

---

## 2. Recipe A: Lambertian shading for rounded shapes (the avatar)

**Reference used:** a generated dinosaur reference image, studied for
overall proportions and colouring (body vs. belly vs. eye as distinct
regions), plus a direct side-by-side comparison against the code's own
rendered output at each iteration.

### Step 1: Draw the SHAPE as a typed ASCII mask, before any colour exists

The only hand-authored part is the silhouette. It is drawn as a grid of
single-character markers, one marker per logical colour ROLE, not per
final colour:

```
"    #### ",
"    #E###",
"    #####",
"    ##   ",
" ######  ",
"  @@ @@  ",
```

`#` = body, `E` = eye, `@` = belly/feet, space = background. The eye and
belly are marked **as their own roles from the start**, even though at
this stage nothing about colour has been decided, the mask only encodes
"this cell belongs to a semantically different part of the creature",
which is a shape question, answerable purely from looking at the
reference image, before any lighting math exists.

**Why this matters for automation:** an image-to-mask step is the one
piece of this pipeline that most needs a human (or a much better vision
model), it's a judgment call about which regions of the reference are
semantically distinct, not something a formula derives. Everything after
this step is mechanical.

### Step 2: Identify the round "lobes" and their centres

Look at the reference for locally-round parts, parts where a sphere or
circle is a reasonable stand-in for the real geometry. The dino has two:
a head and a body. Each gets a `Lobe`, just a `{row, col}` centre point,
picked by eye against the mask's own coordinate grid:

```typescript
const HEAD_LOBE: Lobe = { row: 1, col: 6 };
const BODY_LOBE: Lobe = { row: 4, col: 2 };
```

A row of the mask that doesn't belong to a modelled part (the legs, row
5) is deliberately left OUT of the lobe assignment and rendered flat and
undimmed, stretching a lighting model onto geometry it wasn't fitted to
produces a worse result than admitting a part is unmodelled.

### Step 3: Pick a light direction, once, globally

```typescript
const LIGHT = normalize(-1, -1); // upper-left, in (col, row) terms
```

One light direction is shared by every lobe in the whole piece. This
is a deliberate simplification (real scenes can have multiple lights),
for a small terminal sprite, one consistent direction reads as
coherent; per-lobe custom lighting would look like each body part came
from a different image.

### Step 4: Correct for the terminal cell's real aspect ratio

**This step is easy to skip and produces a subtly wrong result if
skipped.** A terminal character cell is roughly twice as tall as it is
wide. A raw `(col, row)` delta, normalized without correction, treats
one row-step as equal in visual distance to one column-step, so a light
that should read as "45 degrees from upper-left" actually reads as
almost directly overhead, because the row axis is being under-weighted
relative to how it actually looks on screen.

```typescript
const ROW_ASPECT = 0.5;
function surfaceNormal(row, col, lobe) {
  return normalize(col - lobe.col, (row - lobe.row) / ROW_ASPECT);
}
```

Any future terminal-art lighting code must include this correction, or
verify from a reference image why it doesn't need to (e.g. if the target
technique is deliberately not modelling real-world direction at all).

### Step 5: Compute brightness with Lambert's cosine law, HALF-Lambert not textbook Lambert

```typescript
const dot = n.x * LIGHT.x + n.y * LIGHT.y;
return (dot + 1) / 2;          // half-Lambert
// NOT: Math.max(0, dot)       // textbook Lambert — do not use here
```

**This was verified empirically, not assumed.** The textbook clamp
(`max(0, dot)`) was tried first and produced a head that was mostly pure
black, on a silhouette this small, "facing away from the light" covers
most of the visible surface, so a hard clamp to 0 destroys most of the
shape's own reading. Half-Lambert remaps the full `-1..1` range onto
`0..1` instead of clamping the negative half away, so the far side of a
curve stays dim rather than vanishing. **Confirm this against the actual
rendered output before committing to either formula**, which one is
correct depends on how much of the silhouette faces away from the light,
which depends on the specific shape, not a universal rule.

### Step 6: Lift the shadow floor for legibility against a dark background

```typescript
const BRIGHTNESS_FLOOR = 0.35;
function withFloor(b) { return BRIGHTNESS_FLOOR + b * (1 - BRIGHTNESS_FLOOR); }
```

A physically correct near-0 brightness, blended toward a dark theme
background, reads as "this part of the sprite is mostly missing" rather
than "this part is in shadow", the eye can't distinguish "very dim
colour" from "no colour, background showing through" at the low end.
This is a legibility fix layered ON TOP of the physical model, applied
after Lambert, not a replacement for it: the brightest cells (brightness
= 1) are untouched; only the dim end is lifted.

**When to apply this:** whenever the shaded result will be blended
against a variable/dark background rather than composited on an opaque
surface. Check by rendering without the floor first and looking for a
"sparse dots" appearance in the shadowed regions: that's the symptom
that means this step is needed.

### Step 7: Decide which roles get lighting at all

Not every marked region should go through the lighting model:

- `#` (body) → full Lambert treatment, per Steps 2–6.
- `@` (belly) → **flat, fixed colour, no lighting**: a real animal's
  underside markings don't shift with a light source the way a lit
  surface does; treating it as "just another lit region" would be
  applying the model somewhere the reference image doesn't support it.
- `E` (eye) → **flat, no lighting, fixed white-top/black-bottom**: an
  eye reads as shiny/wet, not as matte skin catching ambient light. This
  is a deliberate exception, decided by looking at what a wet, reflective
  surface actually looks like versus a lit diffuse one, not an oversight.

**General lesson for automation:** the lighting model should be applied
selectively per marked role, decided by what kind of surface each role
actually represents in the reference, not blanket-applied to every
non-background cell.

---

## 3. Recipe B: directional edge lighting for faceted/extruded shapes (the logo)

**Reference used:** a generated 3D voxel-style "TORRENT" wordmark image,
studied specifically for which of the block letters' faces were bright,
mid-toned, or dark, and in which direction each face pointed.

### Step 1: Get the shape from an existing source, don't hand-draw it

Unlike the avatar (hand-authored mask), the logo's shape comes from
`@opentui/core`'s bundled ASCII fonts (`fonts.block`, etc.): each glyph
is pre-marked with its own **fill vs. outline segments** (`colorIndex`:
1 = fill, 2 = outline), because the font's author already drew a
fill/outline distinction that follows the real letterform.

**This choice was validated by a prior failure, not assumed correct.**
An earlier attempt used generic neighbour-detection to decide, from
scratch, whether each cell was "an edge" at all (not just which face it
belonged to). That broke the letters R and E specifically, their thin
internal strokes have a disproportionate edge-to-interior ratio under
naive neighbour detection, so most of the letter went dark and stopped
reading as R/E. **Lesson: if a data source (here, the font) already
encodes the distinction you need, use it, don't re-derive from
scratch with a heuristic that can silently misclassify shapes the
heuristic wasn't tested against.**

### Step 2: Study the reference for which face is where

From the "TORRENT" reference image, three visible faces were identified,
each a different brightness:

| Face | Visual position in the reference | Brightness role |
| :--- | :--- | :--- |
| Top | Brightest, most directly facing the (implied) light | Highlight |
| Left/front | Mid-tone | Neutral-ish |
| Right / bottom | Darkest, the shadowed extrusion side | Shadow |

### Step 3: Classify EACH EDGE CELL's face by its neighbours, not by geometry

This is the key difference from Recipe A: there's no lobe, no dot
product, no computed angle. Instead, for a cell already known to be an
edge (font's `colorIndex === 2`), check which of its screen neighbours is
background. That tells you which face it belongs to:

```typescript
if (isBackground(lineIndex - 1, column)) {
  edgeChar = "▓"; mix = 0.85;   // top face — brightest
} else if (isBackground(lineIndex, column + 1) || isBackground(lineIndex + 1, column)) {
  edgeChar = "░"; mix = 0.25;   // right/bottom face — shadow
} else if (isBackground(lineIndex, column - 1)) {
  edgeChar = "▒"; mix = 0.55;   // left face — mid-tone
} else {
  edgeChar = "░"; mix = 0.5;    // interior outline, no open side — default
}
```

**Safety property, worth restating because it's the whole reason this
approach avoided repeating the R/E failure:** neighbour-detection here
only decides WHICH SIDE an already-confirmed edge cell is on. It never
decides whether a cell is an edge in the first place; that question is
answered once, cheaply and correctly, by the font's own `colorIndex`.
Reusing a technique that previously failed is fine once its failure mode
is understood and structurally excluded.

### Step 4: Convert face role to an actual colour via glyph density + blend, not a fixed palette

Each face gets both a different **glyph** (▓ / ▒ / ░, i.e. more or less
visually dense) and a different **blend mix** toward the theme's
background, two independent knobs, not one. `mix` is how far the
blend leans toward the letter's own colour (0 = pure background, 1 =
pure letter colour):

```typescript
const edgeColour = blend(theme.background, letterColour, mix);
```

This keeps the technique theme-aware: it works against any of the
33 palettes, because `theme.background` and the letter's own colour are
looked up live, not hardcoded hex values matched to one specific theme.

---

## 4. Recipe C: motion trails from a reference (the comet-tail sweep)

**Reference used:** two comet reference images the user supplied,
showing a bright head with a tail that thins out gradually over a long
distance and shifts hue along its length (not just fading brightness).

This is NOT a lighting model: a sideways-moving comet has no "up" or
"down" face to shade. It answers a different question: **how does
intensity/colour vary with distance behind a moving point?**

### Step 1: Reject the naive fixed-width band as soon as the reference contradicts it

The prior version (inherited from codemie-opencode) used a fixed
6-column linear cutoff: intensity was either "in the band" or "not",
linearly interpolated within it. The reference images showed no hard
edge at all: a real tail thins out asymptotically, getting fainter and
fainter without a clean stopping point.

### Step 2: Model the falloff as exponential decay, not linear interpolation

```typescript
const TAIL_DECAY = 5;
const dist = beamPos - column;              // columns behind the beam
const t = Math.exp(-dist / TAIL_DECAY);      // never hits a hard edge
return t < 0.02 ? 0 : t;                     // clamp only for cheap culling
```

The `< 0.02` clamp is purely a performance/practicality cutoff (skip
cells that are visually indistinguishable from off), not a claim that
the tail "ends" there physically, the curve itself has no edge.

### Step 3: Model colour as a HUE gradient along the tail, not a single blend

The reference images showed the tail shifting through multiple distinct
hues (white-hot core → the object's own colour → a cooler secondary hue
further back), not just the same colour getting dimmer. This became a
4-stop piecewise blend, verified continuous at each internal boundary
(checked by hand that the two formulas either side of `t=0.7` and
`t=0.25` agree exactly at that boundary value: a discontinuity there
would show as a visible colour "snap" mid-tail):

```typescript
export function cometColour(t, letterColour, coolColour, restColour) {
  if (t > 0.7)  return blend(letterColour, "#ffffff", (t - 0.7) / 0.3);
  if (t > 0.25) return blend(coolColour, letterColour, (t - 0.25) / 0.45);
  return blend(restColour, coolColour, t / 0.25);
}
```

**General lesson:** when a reference shows a MULTI-stop gradient, resist
collapsing it to a single `blend(a, b, t)` for simplicity, count the
visually distinct colour stops in the reference and match that count,
then verify the piecewise stops agree at their shared boundaries.

---

## 5. The half-block rendering trick: apply this LAST, to whatever colours the recipes above produced

Both the avatar and the logo's comet tail use the same final rendering
technique, independent of how the colour was derived:

**A terminal cell has exactly two colour slots: foreground and
background.** Splitting a cell into a TOP half and a BOTTOM half (glyph
`▀`, "upper half block") and colouring each half independently gives two
real, independently-controlled colour samples per cell instead of one,
the maximum sub-cell resolution a terminal genuinely allows without
faking it. Other Unicode sub-cell glyphs (quadrants, sextants, braille)
divide a cell into MORE pieces, but every piece beyond the first two
still shares the same 2 colour slots, so more pieces buys shape
precision at the cost of colour independence, not more real resolution.

**Cell aspect ratio decided top/bottom over left/right.** A terminal cell
is roughly 1:2 (width:height), splitting top/bottom (`▀`/`▄`) yields
roughly SQUARE sub-pieces; splitting left/right (`▌`/`▐`) yields
elongated rectangles. For anything meant to read as a natural shape
(a curved dino, a smooth gradient) square sub-pieces look right and
column-shaped ones look stretched.

```typescript
chunks.push({
  __isChunk: true,
  text: "▀",
  fg: parseColor(topColour),      // upper half's colour
  bg: parseColor(bottomColour),   // lower half's colour
});
```

Apply this step ONLY after Recipe A, B, or C has already produced two
colours (or two brightness values) to put in the two halves: it's a
rendering technique, not a shading technique, and has no opinion about
where those two colours came from.

---

## 6. Colour architecture: where does a colour actually come from?

A recurring decision in all three recipes: is a given region's colour
FIXED, STATE-DRIVEN, or THEME-DRIVEN? Getting this wrong either makes
something ignore the user's theme choice when it shouldn't, or makes
something change colour when the reference shows it should be constant.

| Region | Source | Why |
| :--- | :--- | :--- |
| Avatar body | `theme.progress` (downloading) / `theme.muted` (idle) | App STATE should be visible at a glance |
| Avatar belly/feet | Fixed `#F2C572`, hardcoded | A real animal's markings don't change with app state, confirmed against the reference image, not a default |
| Avatar eye | Fixed white/black, hardcoded | Same reasoning, an eye isn't a state indicator |
| Logo fill (resting) | `theme.text` | Neutral until animated, so it doesn't fight the active theme |
| Logo fill (mid-sweep) | Cycles through `theme.accent/accent2/progress/info/success/warning/error` per letter | Echoes the reference's "rainbow letters" look while staying theme-driven, not a hardcoded palette |
| Logo edges | `blend(theme.background, letterColour, mix)` | Directional shading, but still theme-aware since both ends of the blend are theme lookups |

**Rule of thumb for automation:** ask three questions per region before
picking a colour source, (1) does the reference show this region
changing under different conditions, or does it look constant across
different states of the subject? (2) is this region something the
running application has live state about (progress, activity) that a
user would want reflected? (3) should it look different under a
different colour theme, or is it meant to always look the same
regardless of theme (a fixed "real-world" colour like skin/eye colour)?

---

## 7. Animation without drift: the shared pose-selector pattern

Where a piece has BOTH a shape function and a colour/brightness function
that must describe the exact same frame at the exact same tick (the
avatar's `avatarFrame()` and `avatarBrightness()`), route both through
one shared internal selector (`pickPose()` in `avatar.ts`) rather than
letting each one independently compute "which pose is this tick":

```typescript
function pickPose(name, running, tick): { sprite, top } { /* one decision */ }
export function avatarFrame(name, running, tick) { const { sprite, top } = pickPose(...); return pad(sprite.frame, ...); }
export function avatarBrightness(name, running, tick) { const { sprite, top } = pickPose(...); return pad(sprite.brightness, ...); }
```

Two independently-written "which pose for this tick" functions WILL
eventually disagree after any edit to one but not the other. This
disagreement is the class of bug a shared helper exists specifically
to make structurally impossible, rather than something to remember to
keep in sync by discipline.

**Also: nothing should ever freeze.** An early version of the avatar
only animated while a torrent was downloading, so a fresh install with
no torrents showed a completely static sprite, which reads as broken,
not as "correctly idle". Both states (`running`/idle) need their OWN
animation (idle: occasional blink + slow weight shift; running: hop
cycle + alternating legs), not "animated" vs "frozen".

---

## 8. Verifying work a headless test genuinely cannot see

Some properties of this kind of work can only be confirmed by looking
at a real terminal, and pretending otherwise produces a test that passes
regardless of whether the feature works:

- **Animation/liveness**: a headless capture function that itself
  triggers a render will show "movement" across samples even if the
  live-render request was never actually made, because the act of
  sampling forces the frame to advance. Proven by deliberately disabling
  live-rendering and watching the existing test still pass.
- **Colour/shading correctness against a reference image**: a test can
  assert that SOME styled chunk exists, or that brightness values fall
  in an expected range, but "does this look like the reference image"
  is a judgment call that needs an actual look, not a numeric assertion.
- **Terminal restore, cursor visibility, real keyboard-driven flows**:
  same category as animation: needs a real terminal, not a captured
  frame buffer.

**The general discipline that catches false-positive tests in this
domain (used repeatedly this session):** before trusting a test that's
supposed to catch a specific visual regression, deliberately break the
fix and confirm the test actually fails. A test that passes both with
and without the feature it claims to check is worse than no test: it
looks like coverage.

---

## 9. What a future automated version of this would need

This workflow was entirely manual and interactive this session: image
shared in chat → described back in words → technique chosen by
matching §1's table → code written → shown to the user → iterated.
None of the reference images used are saved anywhere persistent (they
were inline chat attachments, not written to the repo), a real
pipeline would need to decide where reference images live and get
version-controlled alongside the code they produced.

For a `/loop`-style skill to do this with less human-in-the-loop
involvement, it would need, at minimum:

1. **A classifier for §1**: rounded/organic vs. faceted/extruded vs.
   motion-trail, since that's the fork that decides which recipe
   applies. This is squarely a vision-model judgment call, not a
   formula.
2. **A shape-extraction step**: for organic shapes, something has to
   produce the equivalent of the hand-drawn ASCII mask with typed role
   markers (§2 Step 1); for faceted shapes, something has to either
   locate/generate a suitable pre-marked font/asset (§3 Step 1) or
   perform the equivalent of fill/outline segmentation itself.
3. **A face/region classifier for faceted shapes**: matching visible
   faces in the reference to brightness roles (§3 Step 2's table), which
   the neighbour-detection code (§3 Step 3) then mechanically applies.
4. **An explicit exceptions pass**: deciding which regions should
   SKIP the general lighting/colour model entirely (the avatar's eye and
   belly, §2 Step 7) requires recognizing "this looks like a fixed
   real-world colour, not a lit surface" from the reference, which is
   exactly the kind of call a formula won't make on its own.
5. **The verification discipline in §8** built in as a required step,
   not an afterthought, since so much of this domain cannot be
   confirmed by unit-testable assertions alone.

Everything else, the half-Lambert formula, the aspect-ratio correction,
the half-block rendering trick, the exponential-decay tail, the shared
pose-selector pattern, is genuinely mechanical once the judgment calls
above have been made, and could reasonably be templated/generated code
today.
