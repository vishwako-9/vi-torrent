# Component Spec: `src/webtorrent-platform.ts`

**File Path:** [src/webtorrent-platform.ts](../src/webtorrent-platform.ts)
**Role:** The WebTorrent options every client in this project must pass, the one thing standing between "Windows only" and "runs everywhere".

---

## 1. What it does

Exports `platformOptions()`, which returns `{ utp: process.platform === "win32" }`.
Spread it into **every** `new WebTorrent(...)`, including the ones inside tests.

## 2. Why it exists

BitTorrent has two transports. **TCP**, which every peer speaks, and **uTP**, a
congestion-control layer on top of UDP. uTP comes from `utp-native`, a NAPI
module, and NAPI on POSIX is still being completed in Bun.

Loading it on macOS or Linux does not throw. It takes the process down:

```
panic(main thread): unsupported uv function: uv_timer_init
```

A panic cannot be caught, so there is no recovering from it in code. The only
options are to avoid uTP or to not run on those platforms.

## 3. How the cause was found: two wrong guesses first

The project shipped as Windows-only on the belief that WebRTC was to blame:
`node-datachannel` is the obvious NAPI module in the tree, reached via
`webtorrent → bittorrent-tracker → @thaunknown/simple-peer → webrtc-polyfill`.

Measured on Ubuntu 26.04 / WSL2, that was wrong twice:

| Test | Result |
| :--- | :--- |
| `import("node-datachannel")` alone | **fine**, survives indefinitely |
| `new WebTorrent({ wrtc: false })` | **panics**: WebRTC was never the cause |
| `new WebTorrent({ utp: false })` | **55 peers, 642 MB at 11 MB/s in 60s** |

Importing the WebRTC module is harmless; it is uTP that reaches
`uv_timer_init`.

**Two traps cost time on the way there**, both worth remembering:

- A probe script in `/tmp` resolves imports from Bun's **global cache**, which
  has no native binary, and fails with a completely unrelated
  "Cannot find module" error. Probes must live inside the project.
- `--conditions=browser` does **not** redirect `webrtc-polyfill` to its
  native-free `browser.js`. Its exports map lists `node` first, and Bun always
  sets that condition, so `node` wins.

## 4. Why uTP is kept on Windows

It works there: `WebTorrent.UTP_SUPPORT` is `true` and nothing panics.
Disabling it everywhere would give up a real transport to work around a
problem that only exists elsewhere. Losing uTP costs little (TCP is
universal), but there is no reason to pay even that where it is not needed.

## 5. Why it is its own module

Same reason as [`rediscover.ts`](doc_src_helpers.md): the engine, the detached
daemon **and the test helpers** all need it, and importing it from `engine.ts`
would construct the engine singleton, and a second WebTorrent client,
inside the daemon process.

It is also re-exported from `tests/_isolate.ts`. Suites need it, but importing
it directly would put a line **above** `import "./_isolate.js"`, and that
import must come first or the isolation guarantee breaks. Routing it through
`_isolate` keeps one rule instead of two.

## 6. The failure mode if it is forgotten

A client built without it runs perfectly on Windows and panics on POSIX. In
the **daemon** that happens invisibly: it is detached, so nothing surfaces
except background downloads that silently never start.

Nine test files had to be patched when this was introduced, and a hand-written
list of them missed three. The reliable approach is to scan every file that
constructs a client, which is what the audit below does:

```bash
grep -n "new (\?WebTorrent" src/*.ts tests/*.ts tests/*.tsx | grep -v platformOptions
```

Anything that prints is a latent POSIX panic.

## 7. When it can be deleted

When [oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546) lands.
Delete the module, drop the spread from each call site, and uTP returns
everywhere.
