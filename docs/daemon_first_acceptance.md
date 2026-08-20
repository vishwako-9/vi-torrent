# Stage 0: Acceptance checks for the daemon-first rewrite

**Status:** all four stages done (2026-08-02). The daemon-first rewrite is
complete on `daemon-first`: the TUI no longer runs a WebTorrent client at
all in production, a second window is now legitimate (§11), and the suite
is green identically on Windows and Ubuntu. Written **before** any code,
deliberately.

**Three commits landed after stage 4**, out of this document's original
scope (the rewrite itself) but on the same branch, using the architecture
this document verifies: `Shutdown daemon` (button + `/shutdown-daemon`),
`Shutdown when done` (button + `/shutdown-when-done`, `Engine.allFinished()`
in torrent-core.ts), and a follow-up making `Shutdown daemon` close the TUI
window too, not just the daemon. Documented in README.md's "The daemon"
section, not here. This doc's job was proving the rewrite, not tracking
every feature built on top of it afterward.
**Branch when started:** `daemon-first`
**Ships as:** v0.3.0, after v0.2.0 is released off a clean `master`.

---

## 0. Why this document exists first

The two habits that cost the most time on this project were: *done* meaning
"the diff looks right" rather than "the artefact runs", and writing the code
before deciding how it would be checked. This is the second one, corrected.

Nothing here describes an implementation. Every line is something that can be
observed to be true or false when the work is finished.

---

## 1. What is being changed, in one sentence

The TUI stops owning torrents. One WebTorrent client exists in the system, it
lives in the daemon, and it owns every torrent from the moment it is added
until it is removed.

**The concept being deleted is the handover**: the transfer of a torrent
between two processes. Not made more reliable. Removed.

---

## 2. The invariant everything else follows from

> **Exactly one process holds a WebTorrent client, and it is the daemon.**

Mechanically checkable:

```bash
grep -rn "new WebTorrent" src/
```

**Today** that prints `daemon.ts`, `engine.ts`, and four lines in
`webtorrent-platform.ts`. **Afterwards** it must print `daemon.ts` and the
`webtorrent-platform.ts` lines only.

The platform-module hits are prose inside a doc comment; it explains that
`platformOptions()` must be spread into every `new WebTorrent(...)`, so they
are expected and permanent. `engine.ts:262` is the client that has to
disappear; it is the whole point of the exercise.

A check that reports known-good matches trains people to ignore it, so the
expected output is written down rather than left as "should be empty".

Consequences that must all hold:

- Opening or closing the TUI moves nothing.
- A torrent's owner never changes during its life.
- Two TUIs can run at once, because neither owns anything.

---

## 3. Behaviour that must NOT change

The existing suite is the oracle. These are the user-visible behaviours it
already encodes; **all must still pass**, driven through the new architecture.

| Area | Must still be true |
| :--- | :--- |
| Add | magnet and `.torrent` both open the preview dialog, nothing downloads while deciding |
| Preview | file list, sizes, seeders/leechers, All/None, refuses to add with nothing selected |
| Magnets | a previewed magnet still fetches its own metadata (`deselect: true`, not paused) |
| Files | per-file include/skip in Details, skips persist across restart, refuses to skip everything |
| Progress | counts only the files kept: a half-skipped torrent still reaches 100% |
| Actions | pause, resume, remove, remove + files, all working on the ticked set or the cursor row |
| Multi-select | checkbox column, All/None, count in the SEL header, armed delete naming its count |
| Restart | torrents come back **paused**, never silently resuming |
| Metadata | real metadata cached; a stub is never cached and a poisoned cache repairs itself |
| Settings | live / new-torrents-only / next-launch groups behave as documented |
| Ratio | gated on downloaded file bytes, not protocol bytes |
| Visuals | themes, logo wave, avatar, row washes, responsive layout down to 45x12 |
| Input | keyboard, mouse, slash commands, autocomplete |
| Platforms | Windows and Linux, full suite green on both |

**Exit criterion:** every suite that exists today passes, with only the
deletions in §5 removed from them.

---

## 4. New behaviour that must be true

| # | Check | How it is observed |
| :--- | :--- | :--- |
| N1 | Closing the TUI leaves downloads running | close, wait 10s, reopen, progress advanced |
| N2 | Closing the TUI moves nothing | no status ever reads `Starting...`, because that state no longer exists |
| N3 | A second TUI opens successfully | two windows, both listing the same torrents, neither refusing to start |
| N4 | Both windows see the same state | pause in one, the other shows `Paused` within ~1s |
| N5 | TUI starts the daemon when none is running | launch with no daemon, add a torrent, it downloads |
| N6 | Daemon exits when it holds nothing | remove all torrents, wait ~30s, no `bun` process remains |
| N7 | That exit is cancellable | remove all, add one within 30s, the daemon stays and keeps working |
| N8 | Paused counts as held | pause everything, wait 60s, daemon still running |
| N9 | The TUI survives the daemon dying | kill the daemon, the TUI says so plainly and does not crash |
| N10 | The daemon survives the TUI dying | kill the TUI, downloads continue, reopen and they are listed |

---

## 5. What must be GONE

Absence is part of the definition of done. Each of these should return nothing:

```bash
grep -rn "toggleBackground\|handoffToBackground\|pendingRelease" src/
grep -rn "readdLocally\|handingOverItem\|Starting\.\.\." src/
grep -rn "instance-lock" src/
ls src/bg-panel.tsx        # should not exist
```

| Deleted | Because |
| :--- | :--- |
| `bg-panel.tsx` | there is nothing to decide: everything is in the daemon |
| BG column, `Background` / `Stop background` buttons | ditto |
| `toggleBackground`, `handoffToBackground`, `stopBackground` | no transfer exists |
| `pendingRelease`, `readdLocally`, `handingOverItem` | machinery that existed only to survive the gap |
| `Starting...` status | the gap it described is gone |
| `instance-lock.ts` | two viewers are legitimate now - replaced by `presence.ts`, which tracks windows rather than refusing a second one; see §11 |
| three-bucket `getTorrents()` | one source, one list |

**Rough expectation: ~1,000 lines removed, no equivalent added.** If the diff
adds more than it deletes, the design went wrong somewhere.

**All four greps above are now empty; `bg-panel.tsx` does not exist.**

---

## 6. Regression guards: the bugs that motivated this

These failed in real use on 2026-08-02 and must be impossible afterwards, not
merely fixed.

| # | Check | The bug it prevents |
| :--- | :--- | :--- |
| R1 | Row order is stable across refreshes and never depends on ownership | rows reordered as torrents migrated between buckets, so a fixed screen line showed a different torrent each second, read as "the status column flashing" |
| R2 | Every action reaches the engine or reports why | Pause silently did nothing when sent to a daemon that had not started |
| R3 | No control is disabled by a transient state | the BG button was dead while any selected torrent was `Starting...`, locking the user out of nine torrents |
| R4 | The table sorts deterministically (by id) | as R1 |

R1 and R4 are worth an explicit test even though the bucket model is gone:
the assertion is cheap and the failure was expensive.

---

## 7. Explicit non-goals

Not being built, despite Transmission having them: queue ordering, bandwidth
groups, blocklists, port-test, free-space, rename, verify, labels.

Not being changed: the TUI's appearance. `app.tsx` should compile against the
new engine with minimal edits, if it needs rewriting, the proxy interface in
Stage 3 was designed wrong.

---

## 8. Stage gates

Each stage has one exit criterion. **The suite is green at every gate.** A
stage that leaves it red is not finished, and the next stage does not start.

| Stage | Work | Exit criterion | Status |
| :--- | :--- | :--- | :--- |
| 0 | This document | Checks written and agreed | Done |
| 1 | **Delete §5**: the handover, and everything that existed to survive it | Suite green, §5 greps empty, TUI runs | Done |
| 2 | Move the surviving engine into the daemon; widen its API | Every engine method has a route or a status field | Done |
| 3 | TUI `engine` becomes a proxy with identical signatures | `app.tsx` compiles with minimal edits; suite green | Done, fully, including `instance-lock.ts` → `presence.ts` (§11) |
| 4 | Re-point tests, verify both platforms | Windows and Ubuntu green | Done: Windows 514/36, Ubuntu 514/36, identical |

### Why deletion comes first (revised 2026-08-02)

The original order was extract → widen → proxy → **then** delete. That is
backwards. It carries `pendingRelease`, `handingOverItem`, `backgroundFlags`,
`remoteItem`, `readdLocally`, `reclaimFromBackground`, `releaseToBackground`
and `ensureDaemon` across a brand-new seam, and the last stage then deletes
every one of them. Building a seam through code already condemned is wasted
work, and each carry is a chance to introduce a bug in machinery nobody will
ever run.

Deleting first means stage 2 extracts ~900 honest lines instead of ~1,280
ambiguous ones, and there is exactly one ownership rule in force throughout.

**The accepted cost:** between stage 1 and stage 3 this branch has no
background download at all. That is fine: it is a branch, and v0.2.0 on
`master` still has the feature.

**Two deliberate deferrals, so their absence is not read as an oversight:**

- `instance-lock.ts` survives stage 1. §5 kills it because "two viewers are
  legitimate", but that only becomes true once the daemon owns everything.
  During stage 1 a single process still owns torrents, so the lock is still
  doing real work. It dies in stage 3.
- `daemon.ts` and `daemon-client.ts` sit unreferenced after stage 1. Their
  token-HTTP and status-file mechanism is proven and stage 2 rebuilds on it.
  Deleting working code that is about to be re-derived is theatre.

---

## 9. How reads and writes work

Recorded now because it is the decision the whole design rests on, and it is
**already proven**: the daemon does exactly this today for background rows.

| | Mechanism | Why |
| :--- | :--- | :--- |
| **Reads**: torrents, progress, files, peers | status file rewritten every second, read synchronously on the TUI's existing 1s tick | Keeps `getTorrents()` synchronous, so the render path needs no async plumbing. Transmission's own RPC is polled too; its spec states there is no push or subscription capability, so this is the same model with less machinery |
| **Writes**: add, pause, remove, set | HTTP to `127.0.0.1` with the random per-run token, through the existing per-torrent ordering queue | Commands are user-initiated and can afford to be async. The ordering queue already exists and is tested |

Borrowed from Transmission: **one accessor and one mutator** rather than a
route per action. `torrent-get` / `torrent-set` cover most of their API in two
methods; a route per property would grow the surface with every feature.

---

## 10. Known constraint we cannot copy

Transmission chooses files by adding **paused**, reading the file list, setting
files-unwanted, then starting.

That sequence does not work here. WebTorrent discards every peer discovered
while a torrent is paused, and a magnet's metadata comes *from* peers, so a
paused magnet can never learn its own file list. Our preview uses
`deselect: true` instead: connected, accepting metadata, downloading nothing.

This is a WebTorrent constraint, not an architectural one, and it survives the
rewrite unchanged.

---

## 11. Stage 3: the proxy swap, and one open item

`engine.ts` now exports one of two implementations, chosen by
`vi-torrent_TEST` - the same flag `tests/_isolate.ts` already sets, reused for
its stated purpose:

- **Under test:** `torrent-core.ts`'s real `Engine`, in-process, exactly as
  before this rewrite. The ~20 UI test files that mount `<App/>` and drive
  the `engine` singleton directly are testing app.tsx's logic, not the
  process topology - making each one spawn and coordinate a real OS
  subprocess would trade a fast, isolated suite for a slow, flaky one
  without testing anything those tests are actually about.
- **In the shipped app:** `daemon-engine.ts`'s `DaemonEngine`, which proxies
  every call to a daemon over the same status-file-read / HTTP-write channel
  daemon-client.ts already used for background rows. `index.tsx` calls
  `engine.ready()` once, before mounting `<App/>`, to spawn the daemon if
  none is running and wait for its first status snapshot - App()'s body reads
  `engine.getSettings()` synchronously in its first statements, so the daemon
  has to be reachable before then, not lazily on first use.

`app.tsx` required **zero edits**. It imports `engine` and calls methods on
it; it has no idea which class is behind the import, and the type checker
confirms it - `Engine | DaemonEngine` resolves against every call site
app.tsx already had.

**The synchronous-signature problem, and how each method actually answers
it**, since "make it a proxy" undersells how much of this needed a real
answer rather than an `await`:

| Method | How a synchronous answer is still correct |
| :--- | :--- |
| `getTorrents`, `getSettings`, `getPreview`, `getRestoredHashes` | Read the status file directly (`DaemonClient.status()` was already a synchronous `fs.readFileSync`, proven for background rows before this rewrite) |
| `pause`, `resume`, `remove`, `confirmPreview`, `cancelPreview` | Fire-and-forget HTTP POST; the effect shows up on the next synchronous read once the daemon's status file catches up - not a new compromise, the exact behaviour background-owned torrents already had |
| `applySettings` | `RESTART_REQUIRED` comparison computed locally against the settings the caller already has both halves of - no need to wait on the round trip for a pure comparison |
| `previewMagnet`, `previewFile` | Validated synchronously before the request is sent (`validateMagnet`/`validateTorrentFile` hoisted out of `Engine` into module-level exports so both sides use the identical check) - without this, a typo would open the Add dialog and leave it waiting on metadata that was never coming |
| `getFiles`, `getPeers` | The one read that cannot be synchronous end-to-end - the daemon does not bake every file of every torrent into the 1s snapshot. Answered from a small local cache, refreshed by a throttled background fetch. First read after opening Details can be briefly empty - the same thing detail-panel.tsx already showed for any background-owned torrent, now resolving within a second instead of never |
| `setAllFiles` | Returns the count that *would* change, computed against the cached file list with torrent-core.ts's own rule - accurate whenever the cache is fresh, not a guess, since the daemon applies the identical rule server-side |
| `destroy` | A genuine no-op. This is the point: N1/N2 require that closing the TUI moves or stops nothing |

**A real bug found by running it, not by reading the diff** (the same lesson
this project has relearned before - done means the artefact ran, not that
the diff looks right): `daemon.ts`
never created its own state directory. `fs.writeFileSync` does not create
missing parents, so the very first write (`daemon.json`) threw inside the
freshly-spawned child and killed it silently (`stdio: "ignore"` on a
detached spawn swallows the crash). This never surfaced before stage 3
because the TUI's own local engine always ran first and created the
directory as a side effect of `saveSession()`'s `mkdirSync` - the daemon was
always spawned *second*. In the daemon-first world the daemon can be the
first thing to ever touch that path (a genuinely first-ever run). Fixed with
one `fs.mkdirSync(stateDir, { recursive: true })` at the top of daemon.ts.

**Verified beyond the suite** (throwaway script, not part of the permanent
suite, deleted after use - calling `DaemonEngine` directly is exactly as
convincing as driving it through the UI, since app.tsx's wiring is already
proven by the regular suite and is identical regardless of implementation):
daemon spawned for real; a second `DaemonEngine` against the same state
directory came up without spawning a second daemon and saw the identical
torrent list and id (N3/N4); a real file-based torrent previewed and
confirmed with genuine metadata; pause and resume both round-tripped through
real HTTP and read back correctly; settings applied and persisted; and
`destroy()` on the first proxy left the daemon running with the torrent
still listed on the second (N1). Separately, the real entry point
(`bun --conditions=browser run src/index.tsx`) was launched against an
isolated state directory with no test flags at all: it rendered the actual
TUI and auto-spawned the daemon as a distinct OS process, confirmed via two
separate pids.

The `new WebTorrent` grep from §2 now reads:

```
src/torrent-core.ts:290:    this.client = new WebTorrent({
src/webtorrent-platform.ts   (doc comments only)
```

`engine.ts` no longer appears at all - it does not construct a client in any
form. `torrent-core.ts` appearing is expected and correct: it is the
daemon's own engine module, and the same module a unit test constructs
directly and in-process. The invariant this grep stands in for - "in the
shipped app, at runtime, exactly one process holds a WebTorrent client" - was
proven directly by the real-launch check above (two pids, only one of which
ever writes `daemon.json`), which is the more honest check: static text
search can no longer distinguish "used by the daemon" from "also used by
tests" now that both go through the same shared module.

### instance-lock.ts → presence.ts: decided and done

§5 assigned this to stage 3 ("two viewers are legitimate now"). Put to the
user directly rather than decided silently, since it is a real product
choice (silent multi-window vs. today's clear refusal) - answer: **remove
the refusal.**

`instance-lock.ts` is gone; `presence.ts` replaces it. The refusal itself
depended on a reason that no longer exists - the file's own doc comment
named "dual-writer corruption" from two TUIs both writing `session.json`,
and no TUI writes that file any more, only the daemon does. What genuinely
still needed to survive: the browser magnet/`.torrent` handoff (`--handoff`
in index.tsx) has to know whether ANY window is open, to route a clicked
link to it instead of popping a new terminal per click. The old mechanism
was a single pid file that could only ever remember the MOST RECENTLY
launched window - correct for "is anyone home" only by accident, since an
earlier window closing last would stop being found the moment a later one
overwrote the file. `presence.ts` is a directory of one marker file per
live window instead, correct for any number of windows.

Verified with two real processes, not just the unit test: two
`bun --conditions=browser run src/index.tsx` launched against the same
state directory, both stayed running, both appeared in `windows/`
simultaneously, and exactly one daemon existed the whole time - confirmed
via `daemon.json`'s pid never changing while three distinct `bun` pids were
alive at once (one daemon, two TUIs).

---

## Revision history

| Version | Date | Description |
| :--- | :--- | :--- |
| 1.0 | 2026-08-02 | Written before any implementation, at the end of the session that diagnosed the handover bugs in real use. |
| 1.1 | 2026-08-02 | Stage order reversed: deletion moved from last to first, stages renumbered 1-4. Reasoning and the two deliberate deferrals recorded under §8. No check was added, removed or weakened. |
| 1.2 | 2026-08-02 | Stage 1 and 2 executed. `Engine` moved unchanged from engine.ts into a new torrent-core.ts; engine.ts is now a 4-line re-export so the TUI singleton is untouched; daemon.ts constructs its own `Engine` over the same core and exposes every method as an HTTP route or a `/status` field, using core's own types as the wire format rather than a hand-kept parallel shape. daemon-client.ts widened to match (pause/resume/remove kept exactly as before; preview, files, and settings added, each serialised under a fixed queue key since there is only one preview and one settings document at a time). Suite green (36 suites, 515 checks) with zero new tests needed for the daemon side, because it now runs the same tested engine code instead of a duplicate. Daemon smoke-tested standalone: real magnet preview against the live DHT, auth rejection, settings apply-and-persist, clean shutdown. `instance-lock.ts` and the id-based local `Engine` API are both still in place, deliberately - stage 3 is the proxy swap. |
| 1.3 | 2026-08-02 | Stage 3 executed - full account in §11. New `daemon-engine.ts` (`DaemonEngine`, the TUI-side proxy) and a two-way split in engine.ts chosen by `vi-torrent_TEST`, so ~20 UI tests keep the fast in-process engine while the shipped app gets the real daemon-backed one. `app.tsx` needed zero edits. A real bug was found by actually running the daemon standalone (not by reading the diff): it never created its own state directory, so a genuinely first-ever run died silently on the first write. Fixed with one `mkdirSync`. Verified with a throwaway script driving `DaemonEngine` directly against a real spawned daemon (21 checks: dual-proxy state sharing, real file preview, pause/resume round-tripping over HTTP, settings persistence, `destroy()` provably a no-op) and a real launch of the production entry point showing two separate OS processes. Suite still 515/515. One item flagged rather than decided silently: should `instance-lock.ts`'s refusal be removed, now that two windows are verified safe? Put to the user directly. |
| 1.4 | 2026-08-02 | Answered: remove it. `instance-lock.ts` deleted; `presence.ts` replaces it (§11) - a directory of one marker file per live window rather than a single pid file that could only remember the most recent one, since the browser-handoff feature still needs to find ANY open window, not just the last one. `index.tsx`'s startup gate no longer refuses a second launch. Test file renamed test-presence.ts and rewritten for the new semantics (12→11 checks - fewer because there is no more refusal path to assert). Verified with two REAL `bun --conditions=browser run src/index.tsx` processes against one state directory: both stayed running, both registered, exactly one daemon existed throughout. Suite: 36 suites, 514 checks, 0 failed. Every §5 grep now genuinely returns nothing. Stage 3 has no open items left. |
| 1.5 | 2026-08-02 | Stage 4 executed: synced src/, tests/, archive/, package.json, tsconfig.json into the WSL2 Ubuntu copy (rsync, per the project's own note not to run the suite off /mnt/c) and ran it - 36 suites, 514 checks, 0 failed, identical to Windows. Repeated the two-real-windows check from §11 there too, since detached spawning and file locking are exactly the kind of thing that can differ by platform silently: two `bun --conditions=browser run src/index.tsx` processes against one state directory, both stayed alive, both registered, exactly one daemon, no stderr from either, and a clean process tree after teardown (verified via `ps aux`, not just exit codes). All four stages of the acceptance doc are now done. |
