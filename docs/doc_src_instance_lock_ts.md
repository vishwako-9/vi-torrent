# Component Spec: `src/instance-lock.ts`

**File Path:** [src/instance-lock.ts](../src/instance-lock.ts)
**Role:** Refuse to run two vi-torrent windows against the same state directory.

---

## 1. Why it exists

The daemon has always refused to double-start. The TUI never did, so opening
a second window quietly produced two clients sharing one `session.json` and
one download folder.

They then fight. Both rewrite the session index from their own view of the
world, and both open the same files for writing on any torrent they hold in
common: the exact dual-writer corruption that
[the BG handover](doc_src_engine_ts.md#the-handover-window) is carefully
choreographed to avoid.

Found in a screenshot of two windows side by side, each listing a torrent the
other did not, with failures that had no visible cause.

## 2. Mechanism

The daemon's own: a pid file (`vi-torrent.pid` in the state directory) checked
with `process.kill(pid, 0)`.

| Situation | Behaviour |
| :--- | :--- |
| No lock file | Take it |
| Lock held by a **live** pid | Refuse, and report which pid |
| Lock held by a **dead** pid | Take it over: a crash must not lock someone out of their own client |
| Lock held by us | Take it (re-acquiring is not an error) |
| State directory unwritable | **Start anyway**: detecting a second window is a nicety, refusing to run is not |

`releaseInstanceLock()` removes the file **only if it still holds our pid**. A
window that started later owns it by then, and deleting it would unlock the
wrong session.

Released from a `process.on("exit")` handler, which covers Quit, Ctrl+C and a
closed terminal alike. A hard kill leaves the file behind. That is what the
stale-pid path is for.

Skipped entirely under `vi-torrent_TEST`: the suites construct several engines
on purpose, each already isolated to its own temp state directory.

## 3. What the user sees

```
vi-torrent is already running in another window (pid 1636).

  Two windows would share one session and one download folder, and
  would corrupt any torrent they both hold. Use the window that is
  already open, or quit it first.

  If that window has crashed, this will clear on its own once the
  process is gone.
```

Written to **stderr** and exiting `1`, for the same reason the doctor does:
importing `@opentui/core` takes over stdout.

## 4. Tested by

`tests/test-instance-lock.ts`: acquire, refuse, stale takeover, re-acquire,
release-only-our-own, and an unwritable location still allowing startup.
Verified end to end by launching two real instances.

**A test assumption failed here, not the code**: `pid 1` is the obvious
stand-in for "another process" and does not exist on Windows, where the
lowest real pid is 4. The suite uses `process.ppid` instead.
