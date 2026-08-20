# chafa — Technical Spec

| Field | Value |
|---|---|
| **System / project name** | Chafa |
| **Repository** | [hpjansson/chafa](https://github.com/hpjansson/chafa) |
| **Stars / Forks** | 5,115 / 115 (as of 2026-08-09) |
| **License** | LGPL-3.0-or-later (library **and** CLI tool both) |
| **Language(s) / runtime** | C, GNU Autotools build (`configure.ac`/`Makefile.am` - no Meson/CMake); vendors its own `libnsgif` (NetSurf's GIF decoder) and `lodepng` (PNG decoder) rather than depending on external image libraries for those formats |
| **Version studied** | commit `cdd64f5ce82c874372eba60d0068967241af013e`, 2026-07-26 |
| **Direct dependencies** | GLib (required); FreeType2, ImageMagick/libmagickwand, librsvg, libwebp (optional, gate specific input formats) |
| **Purpose (one line)** | Convert image data - including **animated GIFs, frame by frame** - into ANSI/Unicode terminal character art, as both a C library with a public API and a CLI tool |
| **Studied on** | 2026-08-09 - architecture-level read only, see Depth note below |
| **Local clone path** | `research/ascii-animation-study/chafa/` (not installed) |

## Depth note - honest about scope

This one was read at the architecture/file-layout level, not line-by-line - it's a mature C
library and Bun/TypeScript integration was never the plan (see Integration below), so the return
on a full deep-dive is low relative to the other four. What's below is grounded in real file
reads, not guessed, but is intentionally less exhaustive than the other specs.

## What it actually is - correcting the earlier one-line summary

The initial survey called this an image-to-terminal converter for photos. That undersold it:
chafa explicitly handles **animated GIFs**, decoding and converting them **frame by frame**
(there's a dedicated `chafa-frame.c` / `chafa-frame.h` in the library) - so "animation" is a real,
first-class part of what it does, not absent. It's not a *sprite authoring* tool the way
Ascii-Motion is, though - it converts existing raster images/video frames you feed it, it doesn't
let you draw or hand-author ASCII art.

## Architecture (library, `chafa/`)

Clean separation of concerns across ~15 C files:

| File | Responsibility |
|---|---|
| `chafa-canvas.c` / `chafa-canvas-config.c` | The output surface and its configuration (dimensions, colour mode, symbol set) |
| `chafa-frame.c` | Per-frame handling - this is where animated-GIF frame sequencing lives |
| `chafa-image.c` | Image data abstraction, decoupled from any one decoder |
| `chafa-parser.c` | Input format parsing/dispatch |
| `chafa-symbol-map.c` | **The actual pixel-to-character mapping** - which glyph best represents a block of pixels |
| `chafa-placement.c` | Positioning output within the canvas |
| `chafa-stream-reader.c` / `chafa-stream-writer.c` | I/O boundary |

The `chafa-symbol-map.c` module is the conceptually interesting one: it's solving "given this
block of image pixels, which terminal character (from a configurable symbol set) best represents
it" - a real image-analysis problem (density/luminance/shape matching against a glyph set), not a
simple lookup. Did not read this file's internals in depth (see Depth note) - flagging its
existence and role, not its algorithm.

## Why this isn't a real integration candidate for vi-torrent

1. **C library, Autotools build** - Bun/TypeScript has no direct binding; using it would mean
   either shelling out to the compiled `chafa` CLI as a subprocess (adds an external binary
   dependency vi-torrent doesn't otherwise have) or writing Bun FFI bindings against `libchafa`
   (real engineering effort, precedent exists in this codebase - `@opentui/core` itself is
   Zig+FFI - but disproportionate for what's needed here).
2. **Wrong input shape.** It converts *raster images* (photos, GIF frames, video frames) to
   terminal art. vi-torrent's avatar is a *hand-authored sprite* with discrete animation frames,
   not something with source raster imagery to convert. There's no photo of a dino to feed it.
3. **LGPL-3.0** - more permissive than cfonts' GPL-3.0 (LGPL allows dynamic linking without
   copyleft spreading to the linking program), but still adds licensing surface for something
   that doesn't fit the actual need.

## Synthesis - what's actually usable for vi-torrent

1. **Not an integration candidate** - wrong problem (image conversion, not sprite animation),
   wrong language/runtime for the effort involved.
2. **One transferable concept, not code**: `chafa-symbol-map.c`'s job - mapping a region of
   visual data to the best-matching terminal character from a set - is the same *category* of
   problem a real 3D-to-ASCII avatar renderer would face (projecting a 3D surface's lit intensity
   per screen cell, then picking a character/colour to represent it). If the "make the avatar 3D"
   direction ever moves toward actual 3D projection (rather than a richer hand-authored sprite via
   Ascii-Motion), this is the right *category* of algorithm to study in more depth then - revisit
   this file specifically at that point, this spec did not go deep enough to reuse the technique
   yet.
3. Confirms, by contrast with Ascii-Motion, the real distinction in this whole research set:
   **tools that convert existing visuals** (chafa) vs. **tools that let you author ASCII art by
   hand** (Ascii-Motion, cfonts' static glyphs). vi-torrent's avatar work needs the latter category.
