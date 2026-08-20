# Exhaustive Code Deconstruction & Line-by-Line Technical Analysis

This document provides a block-by-block, section-by-section, and line-range technical deconstruction ("debunking") of all 15 source files in `src/`. It explains the exact mechanics of every code block, inputs, outputs, side effects, and precise relationships between modules.

---

## 1. `src/index.tsx` (Lines 1–80)

| Line Range | Code Segment / Feature | Functional Mechanics & Side Effects | Inter-Module Connections |
| :--- | :--- | :--- | :--- |
| **L1-L18** | Imports & Environment Constants | Imports `render`, `extend`, `setRenderLibPath` from `@opentui/solid` and `@opentui/core`. Defines sentinel `vi-torrent_RELAUNCHED = "vi-torrent_RELAUNCHED"`. | Initializes OpenTUI Solid rendering framework. |
| **L20-L49** | Relaunch Guard (`needsBrowserConditions`) | `Bun.resolveSync("solid-js", ...)` checks if `solid-js` resolves to `dist/server.js`. If true, `Bun.spawnSync` re-executes `bun --conditions=browser run src/index.tsx` to force browser reactivity condition. Exits parent process. | Prevents Bun from using Node's non-reactive SSR build of SolidJS. |
| **L51-L64** | POSIX Signal Handlers | Listens to `SIGINT`, `SIGTERM`, `SIGHUP`. On signal, invokes `engine.handoffToBackground()` to pass flagged torrents to daemon, calls `engine.destroy()`, and schedules `process.exit(0)` after 300ms. | Connects to `src/engine.ts` singleton for safe exit. |
| **L66-L77** | OpenTUI Custom Element Setup | Calls `setRenderLibPath()` to point `@opentui/core` FFI to `opentui.dll`. Calls `extend()` registering JSX tags: `<table />`, `<ascii_font />`, `<input />`, `<select />`. | Configures Zig/C++ FFI native layer for OpenTUI. |
| **L79-L80** | Mount Root Component | Calls `render(() => <App />)` to start the TUI render loop. | Mounts `src/app.tsx` `<App />` component. |

---

## 2. `src/app.tsx` (Lines 1–779)

| Line Range | Code Segment / Feature | Functional Mechanics & Side Effects | Inter-Module Connections |
| :--- | :--- | :--- | :--- |
| **L1-L24** | Imports & Header Constants | Imports Solid signals, OpenTUI renderables (`TextTableRenderable`, `InputRenderable`), `engine`, `Button`, `SettingsPanel`, `DetailPanel`, `theme`. Defines `TABLE_HEADERS` array containing `"Ratio"` at index 8. | Integrates all UI overlays, engine singleton, and theme tokens. |
| **L34-L85** | `formatTorrentTableContent()` | Constructs `TextTableContent` data array. Converts header labels to bold colored chunks (`theme.accent`). Maps each `TorrentItem` into cell chunks: selection checkbox `[x]`/`[ ]`, background flag `[x]`, ID, name, size, multi-chunk progress bar (`progressSegments`), speeds, ratio, and status. | Consumes `src/format.ts` (`progressSegments`) and `src/theme.ts`. |
| **L87-L105** | App State Signals | Initializes Solid signals: `torrents`, `errorMsg`, `selectedIndex`, `suggestions`, `suggestionIndex`, `armedDeleteKey`, `checked`, `remoteCount`, `refreshTick`. | Local reactive state for UI navigation. |
| **L114-L166** | `shutdown()` Procedure | Triggers `engine.handoffToBackground()`, `engine.destroy()`, `renderer.stop()`, and `renderer.destroy()`. Writes explicit ANSI escape codes (`\x1b[?1049l` leave alt buffer, `\x1b[?25h` show cursor, `\x1b[0m` attribute reset) to stdout to guarantee terminal restore. | Prevents terminal corruption on exit. |
| **L195-L200** | `modalKey()` Router | Intercepts keyboard navigation when an overlay is open and forwards to `overlayKey()`. Overlays register themselves with a priority, so there is no per-panel if-chain. | Connects to `src/overlay.tsx`. |
| **L202-L251** | Slash Command Autocomplete | `matchCommands()` filters `COMMANDS` matching input prefix. Arrow keys navigate suggestion list; `Tab` or mouse click calls `acceptSuggestion()`; Enter calls `submitSuggestion()`. | Consumes `COMMANDS` from `src/theme.ts`. |
| **L282-L291** | `selectRowAt(screenRow)` | Maps clicked screen Y coordinate to table row index by subtracting `tableRef.screenY + 3` and dividing by 2 (accounting for header and inter-row borders). Updates `selectedIndex`. | Mouse click target calculation for table. |
| **L293-L308** | `updateTorrents()` | Fetches `engine.getTorrents()`, updates `remoteCount`, increments `refreshTick`, and assigns formatted content imperatively to `tableRef.content`. | Polls `src/engine.ts` on 1s refresh interval. |
| **L433-L489** | `handleCommand(cmd)` Dispatcher | Parses typed slash commands (`/add-magnet`, `/add-file`, `/pause`, `/resume`, `/remove`, `/theme`, `/details`, `/settings`, `/quit`). Throws readable errors on invalid args. | Command execution pipeline. |
| **L506-L541** | `act()` & `removeWithFiles()` | Executes engine actions on every target - ticked rows, or the cursor row when nothing is ticked. `removeWithFiles()` implements the 2-click safety confirm: the first click sets `armedDeleteKey` to the joined ids of the whole target set, so changing the selection disarms it; the second executes `engine.remove(id, true)` for each. | Safety mechanism for file deletion. |
| **L543-L608** | JSX Header & Button Strip | Renders `<ascii_font />` logo, `hintTextRef`, and 9 button chips (`Button` component). | Top control interface. |
| **L610-L630** | JSX Table Box | Renders `<table />` enclosed in rounded border `<box />`. Registers `onMouseDown` click listener. | Main torrent table viewport. |
| **L640-L657** | JSX Autocomplete Overlay | Floating rounded `<box />` displaying command suggestions when typing `/`. Mouse clicks call `chooseSuggestionAt(y)`. | Interactive command popup. |
| **L659-L736** | JSX Input Bar & Interceptor | Renders command prompt `❯` and `<input />`. Binds `interceptKeyPress()` to handle `Ctrl+C`, `Up`, `Down`, `Left`, `Right`, `Return`, `Tab`, `Escape`. | User input line & shortcut router. |
| **L738-L765** | JSX Modal Overlay Mounting | Mounts `<SettingsPanel />` and `<DetailPanel />` overlays at `zIndex={200}`. | Overlay mounting layer. |

---

## 3. `src/engine.ts` (Lines 1–818)

| Line Range | Code Segment / Feature | Functional Mechanics & Side Effects | Inter-Module Connections |
| :--- | :--- | :--- | :--- |
| **L75-L134** | Engine Constructor & Isolation Guard | Initializes directory paths (`downloadDir`, `stateDir`, `torrentCacheDir`, `indexPath`). Throws if `vi-torrent_TEST === "1"` attempts to use live `~/.vi-torrent` directory. Loads `settings.json`. Constructs `WebTorrent` instance. Loads `session.json`. | Guarantees test isolation and loads state files. |
| **L135-L150** | WebTorrent Client Initialization | Passes configuration options to WebTorrent (`maxConns`, `dht`, `utPex`, `lsd`, `secure`, `torrentPort`, `natUpnp`, `natPmp`, `downloadLimit`, `uploadLimit`). | Configures BitTorrent protocol stack. |
| **L167-L189** | Session Event Listeners | On WebTorrent `torrent` event (metadata ready), calls `applySkippedFiles()` and `saveSession()`. On `error` and `unhandledRejection`, catches errors and routes them to `onError` listener. | Prevents unhandled promises from crashing app. |
| **L221-L236** | `applySettings(next)` | Persists updated settings to `settings.json`. Applies live speed limits (`throttleDownload`, `throttleUpload`) and `maxConns`. Returns boolean indicating if restart is required. | Saved via `src/settings.ts`. |
| **L243-L253** | `enforceSeedRatio()` | Scans active torrents on every tick. If `torrent.ratio >= seedRatioLimit`, automatically pauses the seeding torrent. | Enforces user seed ratio caps. |
| **L260-L275** | `idFor(infoHash)` & `torrentById(id)` | Maps 40-character `infoHash` strings to stable incremental integer IDs (`idByInfoHash`). Ensures array index shifts never target wrong torrent. | Stable ID mapping architecture. |
| **L277-L314** | `previewMagnet()` & `previewFile()` | Same validation as before: magnet scheme, file existence, bencode header (`0x64`), HTML rejection; but they open a **preview** instead of adding. Nothing enters the session until `confirmPreview()`. | Torrent ingestion validation layer. |
| **L325-L337** | `pause(id)` & `resume(id)` | Routes pause/resume to local torrent or daemon (`DaemonClient`). `resume()` calls `rediscover(torrent)` to force tracker re-announce and DHT lookup. | Uses `src/rediscover.ts` and `src/daemon-client.ts`. |
| **L346-L379** | `remove(id, deleteFiles)` | Removes torrent from session and disk. If `deleteFiles` is true, calls `destroyStore` and invokes `removeTorrentFolder(savePath, name)` to delete empty directory tree. | Uses `src/remove-folder.ts`. |
| **L390-L449** | `saveSession()` & `readIndex()` | Serializes active torrent metadata to `~/.vi-torrent/session.json`. Caches raw `.torrent` file bytes in `~/.vi-torrent/torrents/<infoHash>.torrent` for offline re-verification. | Session index persistence engine. |
| **L473-L521** | `toggleBackground(id)` & `releaseToBackground()` | Toggles background flag. Releasing to background destroys local torrent instance (keeping files on disk) and hands off to `src/daemon.ts`. | Background process delegation bridge. |
| **L531-L552** | `reclaimFromBackground()` | Pulls background torrent back into local process in `paused` state by instructing daemon to drop it without deleting files. | Reclaims background download. |
| **L625-L662** | `restore()` | Restores torrents from `session.json` on startup in `paused` state. Checks if daemon already owns a torrent to prevent dual-writer corruption. | Session restoration engine. |
| **L664-L692** | `format()` Item Serializer | Converts WebTorrent status into `TorrentItem` UI data structure. Calculates ratio string (`uploaded / downloaded`). Formats status (`Paused`, `Done`, `Background`, `Downloading`, `Starting...`). | Consumes `src/format.ts`. |
| **L695-L753** | `getFiles()`, `getPeers()`, `toggleFile()` | `getFiles()` returns file list; `getPeers()` returns wire connections; `toggleFile()` calls `select()` / `deselect()` on WebTorrent file priorities. Refuses to deselect all files. | Per-file & peer inspection layer. |

---

## 4. `src/daemon.ts` (Lines 1–261)

| Line Range | Code Segment / Feature | Functional Mechanics & Side Effects | Inter-Module Connections |
| :--- | :--- | :--- | :--- |
| **L34-L46** | CLI Arguments & Directory Setup | Parses `--state <stateDir>`. Sets paths for `session.json`, `daemon.json`, `daemon-status.json`, `daemon.log`. | Process CLI initialization. |
| **L57-L78** | Single-Instance Daemon Lock | Checks if `daemon.json` exists. Sends signal 0 (`process.kill(pid, 0)`) to check PID liveness. Exits immediately if another daemon is running. | Dual-writer prevention guard. |
| **L80-L107** | Session Ingestion & WebTorrent Init | Reads `session.json`. Filters entries where `background: true`. Initializes standalone WebTorrent client and adds background torrents from cached `.torrent` files or magnet URIs. | Background torrent initialization. |
| **L109-L136** | `writeStatus()` Snapshot Writer | Serializes live background torrent progress into `daemon-status.json` every 1 second. | Synchronous status reporting channel. |
| **L157-L241** | HTTP IPC Control Server | Listens on `127.0.0.1:0` with random 24-byte hex token. Requires `x-vi-torrent-token` header. Handles `/status`, `/add`, `/pause`, `/resume`, `/remove`, `/shutdown`. Calls `shutdown(0)` when torrent count reaches 0. | Asynchronous control IPC channel. |
| **L243-L260** | Server Listening & Shutdown Handlers | Writes `daemon.json` with `{ pid, port, token, startedAt }`. Registers `SIGINT`, `SIGTERM`, `SIGHUP` shutdown handlers. | Process initialization & signal handling. |

---

## 5. `src/daemon-client.ts` (Lines 1–121)

| Line Range | Code Segment / Feature | Functional Mechanics & Side Effects | Inter-Module Connections |
| :--- | :--- | :--- | :--- |
| **L35-L68** | Liveness & Handle Verification | Reads `daemon.json`. Sends signal 0 (`process.kill(h.pid, 0)`). `isRunning()` returns boolean liveness status. | Health check for background daemon. |
| **L75-L81** | Synchronous `torrents()` Reader | Synchronously reads `daemon-status.json`. Checks `updatedAt` against `STALE_MS = 8000`. Returns `[]` if snapshot is stale or daemon is dead. | Synchronous status reader for TUI table. |
| **L83-L106** | HTTP Command Proxy | Wraps `fetch()` requests to `http://127.0.0.1:<port>` with `x-vi-torrent-token` header for `add`, `pause`, `resume`, `remove`, `shutdown`. | HTTP IPC proxy client. |
| **L112-L120** | `spawnDetached()` Process Launcher | Spawns `bun run src/daemon.ts --state <stateDir>` with `{ detached: true, stdio: "ignore", windowsHide: true }`. Calls `child.unref()`. | Detached background process spawner. |

---

## 6. UI Overlays & Utility Modules (`src/`)

### `src/settings-panel.tsx` (Lines 1–222)
- **L35-L66**: `FIELDS` configuration array defining 12 settings, ladder step logic (`SPEED_STEPS`), and hint formatters.
- **L97-L105**: `open()` method copying draft settings, resetting cursor, and recording initial active theme name.
- **L127-L138**: `createEffect` generating formatted string array for settings menu rows imperatively (`❯ Label Value Hint (next launch)`).
- **L149-L183**: `handleKey()` handling `Up`/`Down` cursor, `Left`/`Right` stepping, `Enter` saving, and `Escape` cancelling (restoring pre-open theme).

### `src/settings.ts` (Lines 1–104)
- **L22-L46**: `AppSettings` interface definition.
- **L49-L51**: `RESTART_REQUIRED` array (`"dht"`, `"pex"`, `"lsd"`, `"encryption"`, `"torrentPort"`, `"portForwarding"`).
- **L53-L69**: `defaultSettings()` factory.
- **L71-L82**: `loadSettings()` reading `settings.json` and merging over defaults.
- **L94-L103**: `describe()` human-readable string formatter.

### `src/detail-panel.tsx` (Lines 1–156)
- **L44-L100**: `createEffect` formatting file list (`[x]`/`[ ]`, progress bar) and peer list (`IP:Port`, wire type, speeds). Caps peer list to 8 rows (`+ N more`).
- **L111-L124**: `handleKey()` handling file cursor navigation (`Up`/`Down`) and file inclusion toggling (`Space`/`Left`/`Right`).

### `src/button.tsx` (Lines 1–92)
- **L40-L72**: `createEffect` applying hover background fill (`theme.accent` or `theme.error`), text color, and borderless 1-row height (`height={1}`).
- **L82-L86**: `onMouseDown` click handler executing `props.onPress()`.

### `src/theme.ts` (Lines 1–175)
- **L40-L107**: `THEMES` array defining 12 palettes (`claude`, `nord`, `gruvbox`, `dracula`, `matrix`, `tokyo`, `catppuccin`, `solarized`, `light`, `darkplus`, `neon`, `mono`).
- **L119-L143**: `theme` mutable singleton object, `themeVersion` signal, and `applyTheme(name)` function modifying palette in place.
- **L156-L175**: `COMMANDS` registry and `matchCommands()` prefix matcher.

### `src/format.ts` (Lines 1–76)
- **L11-L23**: `formatBytes()` scaling bytes to `B`, `KB`, `MB`, `GB`, `TB`.
- **L26-L29**: `formatSpeed()` returning `"-"` for idle transfers.
- **L52-L69**: `progressSegments()` building `left`, `filled`, `empty`, `right` glyph chunks with boundary precision protection.

### Helper Modules
- **`src/keyboard-utils.ts`**: `interceptKeyPress()` wrapping `InputRenderable.handleKeyPress` for focused key handling.
- **`src/remove-folder.ts`**: `removeTorrentFolder()` checking `holdsNoFiles()` and path traversal safety before removing multi-file torrent folders.
- **`src/rediscover.ts`**: `rediscover()` calling `tracker.update()` and `dht.lookup()` on unpause.
- **`src/bun.d.ts`**: Ambient Bun runtime type definitions.
