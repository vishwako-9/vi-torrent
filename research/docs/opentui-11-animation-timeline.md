# OpenTUI's Timeline animation engine

Source: `packages/core/src/animation/Timeline.ts` in `research/ascii-animation-study/opentui`
(commit `de64d210e4f0163720fc1fbfa838d4d1aad47d53`, 0.5.1). See
[opentui-00-overview.md](opentui-00-overview.md) for the full repo header/metadata - this doc
covers only the one module, added specifically for the ASCII-animation-study research
(2026-08-09), since docs 01-10 (written earlier, for the daemon-first rewrite) never touched it.

## What it is

A real, first-class tweening/timeline animation engine, structurally similar to `anime.js`
(chainable `.add()`/`.play()`/`.pause()` API, named easing functions, timeline composition) -
**not** a thin wrapper, a genuine implementation with its own easing curve library:

```typescript
const easingFunctions = {
  linear, inQuad, outQuad, inOutQuad,
  inExpo, outExpo,
  inOutSine,
  outBounce, inBounce,
  inCirc, outCirc, inOutCirc,
  outElastic,
  // (truncated - full set has more; this is what a 100-line read surfaced)
};
```

## Public API (from the real method list, `Timeline.ts`)

| Method | Purpose |
|---|---|
| `new Timeline(options)` | `{duration?, loop?, autoplay?, onComplete?, onPause?}` |
| `.add(target, properties, startTime)` | Animate numeric properties on `target` - `properties` is `{duration, ease?, onUpdate?, onComplete?, loop?, alternate?, ...}` |
| `.once(target, properties)` | Single-shot variant |
| `.call(callback, startTime)` | Schedule a plain callback at a point in the timeline |
| `.sync(timeline, startTime)` | Nest one timeline inside another |
| `.play()` / `.pause()` / `.restart()` | Playback control |
| `.update(deltaTime)` | Advance by a frame - called from the renderer's own loop once `.attach(renderer)` is used |
| `.attach(renderer)` / `.detach()` | Hook into `CliRenderer`'s render loop so `.update()` is called automatically - no manual `setInterval` needed |

Solid binding: `useTimeline(options)` in `packages/solid/src/elements/hooks.ts` just constructs
`new Timeline(options)` and returns it - a thin hook, all the real logic is in core.

## Why vi-torrent doesn't (and mostly shouldn't) use this for the logo sweep

This is built for **continuous property tweening** - animating a numeric value (position,
opacity, a single colour) smoothly from A to B over a duration, with an easing curve shaping the
transition. The logo sweep is a fundamentally different shape of problem: it recomputes, every
tick, **every cell in a 2D character grid** based on that cell's distance from a moving beam
position - there's no single "target" with "properties" being tweened, there's a per-cell
function evaluated across the whole grid each frame. Ascii-Motion's own OpenTUI export plan doc
(see `ascii-ascii-motion-00-overview.md`) hit this exact same wall and explicitly chose
`setInterval` over `useTimeline` for the same reason - discrete, whole-grid recomputation doesn't
fit a single-target tween API. Confirms this isn't a vi-torrent-specific limitation; it's the
right call independently reached twice.

## Where it actually would help - a real, honest opportunity

The **beam position itself** (`sweepIntensity`'s `tick % totalFrames`) is currently a hand-rolled
linear counter with a hard-coded pause. That specific *scalar* value - "how far along is the
sweep, 0 to 1" - is exactly the shape of thing `Timeline.add()` tweens well, and doing it that way
would get one of the professional easing curves above (`outElastic`, `outBounce`, `inOutSine`, ...)
for free instead of the current strictly-linear triangular falloff. Concretely: a `Timeline`
animating a single `{progress: 0}` object from 0→1 with `ease: "inOutSine"` and `loop: true`,
read each frame via `.progress` (or an `onUpdate` callback storing it in a Solid signal), could
replace `animTick() % totalFrames` as the phase driver - while the actual per-cell colour/darkness
computation (`sweepIntensity`, the edge-detection, `blend()`) stays exactly as it is, since that
part was never the piece Timeline is built for.

**Not implemented tonight** - flagging as a genuine, scoped opportunity for a future pass, not
acting on it now given how much the animation code already changed this session.
