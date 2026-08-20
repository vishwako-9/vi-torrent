# Third-party software

vi-torrent itself is MIT (see [LICENSE](LICENSE)). It does not bundle any of
the software below. Everything here is fetched from the public npm registry
when you run `bun install`, and stays under its own licence.

## What you install before vi-torrent

| | | |
|---|---|---|
| **Bun** | MIT | The runtime. Not an npm dependency: you install it yourself, from [bun.sh](https://bun.sh). |

**Windows may warn about `bun.exe`.** SmartScreen shows "Windows protected
your PC" for executables it has not seen often enough to have built a
reputation for, which is a popularity signal, not a malware finding. Bun is
the JavaScript runtime from Oven, MIT-licensed, source at
[github.com/oven-sh/bun](https://github.com/oven-sh/bun). Download it from
`bun.sh` or install it with `winget install Oven-sh.Bun`. Do not take it from
anywhere else, which is the part that actually matters.

## Direct dependencies

| Package | Version | Licence | Source |
|---|---|---|---|
| `@opentui/core` | 0.4.5 | MIT | [anomalyco/opentui](https://github.com/anomalyco/opentui) |
| `@opentui/solid` | 0.4.5 | MIT | [anomalyco/opentui](https://github.com/anomalyco/opentui) |
| `solid-js` | 1.9.12 | MIT | [solidjs/solid](https://github.com/solidjs/solid) |
| `webtorrent` | 3.0.21 | MIT | [webtorrent/webtorrent](https://github.com/webtorrent/webtorrent) |

`@opentui/core` pulls one native binary matching your platform
(`@opentui/core-{darwin,linux,win32}-{x64,arm64}`), also MIT. That is a
compiled library loaded over FFI, which is why Bun specifically is required.
See the README.

## Transitive dependencies

Roughly 280 packages, all under permissive licences: MIT (~234), Apache-2.0
(~21), ISC (~17), BSD-2/3-Clause, BlueOak-1.0.0, and CC-BY-4.0 for one data
package (`caniuse-lite`).

One package, `node-datachannel` (WebRTC transport, reached through
WebTorrent), is **MPL-2.0**, a file-level copyleft. It is used unmodified as
a dependency, which MPL-2.0 permits in a project under any licence; the
obligation would only attach if you modified its own source files.

To regenerate this list:

```
bun pm ls --all
```

## Not a dependency, but worth saying

The ASCII block font used for the logo comes from `@opentui/core`'s bundled
font data (MIT, above). The pixel avatar is original artwork for this project.

The 33 colour themes in `src/theme.ts` are ported from
[codemie-opencode](https://github.com/codemie-ai/codemie-opencode) (MIT,
Copyright 2025 opencode; codemie-opencode is a fork of
[sst/opencode](https://github.com/sst/opencode)), which is not otherwise a
dependency of vi-torrent. The raw colour values are theirs; the conversion
from their theme schema to vi-torrent's `Palette` shape, and the code that
applies it, are original to this project (`scripts/gen-themes.mjs`). The
logo's sweep animation (`sweepIntensity()` in `src/logo.ts`) follows the
shape of codemie-opencode's own logo animation (a band that sweeps once then
pauses, rather than vi-torrent's earlier continuous wave) but is a fresh
implementation, not copied source, integrated with vi-torrent's own
font-glyph-based logo renderer.
