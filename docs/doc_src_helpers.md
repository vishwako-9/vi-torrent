# Component Specs: Helper Utility Modules

---

# 1. `src/keyboard-utils.ts`

**File Path:** [src/keyboard-utils.ts](../src/keyboard-utils.ts)  
**Role:** Text input key interception wrapper for focused `@opentui/core` `InputRenderable` instances.

### Functional Specification
- OpenTUI's `InputRenderable` instance consumes all keystrokes in its native `handleKeyPress` method. Global `useKeyboard` event subscribers never receive key events while an input is focused.
- `interceptKeyPress(el, shortcuts)` wraps `el.handleKeyPress` on the input instance itself:
  - Iterates over configured shortcut definitions (`name`, `ctrl`, `handler`).
  - Matches exact key names or wildcard `"*"` matches (used while modal overlays own the screen).
  - If a shortcut handler returns `false`, execution falls through to the original `InputRenderable` handler (e.g. allowing `Left`/`Right` arrow keys to move the text cursor when modals are closed).
  - If matched and consumed, returns `true`, preventing the input from processing the keystroke.

---

# 2. `src/remove-folder.ts`

**File Path:** [src/remove-folder.ts](../src/remove-folder.ts)  
**Role:** Safe directory cleanup for multi-file torrents after `destroyStore` deletes files.

### Functional Specification
- WebTorrent's `destroyStore` option deletes the downloaded files of a multi-file torrent but leaves empty directory trees on disk.
- `removeTorrentFolder(savePath, torrentName)` safely removes the directory:
  - **Safety Boundaries**:
    - Ensures target folder path resides strictly inside `savePath` (prevents path traversal via `..`).
    - Verifies that target path is NOT the `savePath` directory itself.
    - `holdsNoFiles(dir)` recursively checks that the folder contains NO remaining user files before deleting.
  - Returns `true` if directory was removed, `false` otherwise. Exceptions are caught silently to prevent cleanup failures from taking the app down.

---

# 3. `src/rediscover.ts`

**File Path:** [src/rediscover.ts](../src/rediscover.ts)  
**Role:** Forces immediate peer tracker re-announce and DHT lookup when un-pausing a torrent.

### Functional Specification
- WebTorrent discards all peer announcements received while a torrent is paused ("ignoring peer: torrent is paused").
- Standard `torrent.resume()` only drains its existing internal queue, which is empty. Without re-announcing, an unpaused torrent would sit at 0 peers for up to 30 minutes until the next tracker announce interval.
- `rediscover(torrent)` safely calls:
  - `torrent.discovery.tracker.update()`, **throttled**, see below
  - `torrent.discovery.dht.lookup(torrent.infoHash)`, every call
- Isolated in its own file so both `src/engine.ts` and `src/daemon.ts` can import it without instantiating duplicate `Engine` singletons.

### `MIN_FORCED_ANNOUNCE_MS`: one forced announce per torrent per 10s

`resume()`, `restore()`, `confirmPreview()` and the background handover all
call this, and none of them was throttled. Trackers publish a minimum interval
and expect it to be respected.

The throttle exists on principle rather than because of a proven incident,
and the honest story of how it got here is worth keeping.

Two torrents sat at zero peers and Ubuntu's trackers were returning **HTTP
400** to every announce, minutes after reporting 1532 and 1171 seeders. The
untrottled announces looked like an obvious culprit, so the throttle was
written and the cause recorded as self-inflicted rate limiting.

**That diagnosis was wrong.** A hand-built announce to the same tracker, from
the same address, moments later returned **HTTP 200 with a full peer list**, so nothing had been refused. The real split turned out to be the transport:
against Debian's `http://` tracker the client picks up 32 peers and metadata
within seconds; against Ubuntu's `https://` one it gets none, while a plain
`fetch()` to that same URL succeeds. That points at the tracker client's HTTPS
path under Bun, and it is not resolved here.

The throttle stays regardless. Announcing on every Resume, restore and
handover with no floor at all is the wrong behaviour whether or not it was
what broke that day, and trackers publish a minimum interval precisely to say
so.

**The DHT is still asked on every call**, peer-to-peer, no interval to
respect, no central party to annoy, so a throttled call still does something
rather than silently nothing.

`forgetAnnounce(infoHash)` clears the window when a torrent is removed, so
re-adding one is never refused the announce it most needs.

**60 seconds was the first attempt and it was wrong.** Add a torrent, pause
it, resume it, all inside that window, and the resume announced nothing and
found no peers, which is the exact bug `rediscover()` exists to prevent.
`tests/test-resume.ts` caught it. Ten seconds collapses any burst a person can
produce while leaving deliberate actions their announce.

Covered by `tests/test-rediscover-throttle.ts`.

---

# 4. `src/bun.d.ts`

**File Path:** [src/bun.d.ts](../src/bun.d.ts)  
**Role:** Ambient type declaration file for Bun runtime APIs.

### Functional Specification
- Declares ambient TypeScript module interfaces for Bun built-in modules (`bun`, `Bun`).
- Ensures type-checking passes for `Bun.spawnSync`, `Bun.resolveSync`, and `import.meta.dir`.
