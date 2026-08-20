# Component Spec: `src/handoff.ts`

**File Path:** [src/handoff.ts](../src/handoff.ts)
**Role:** Carry a magnet link or `.torrent` path from the process the operating system launched into the window that is already open.

---

## 1. Why it exists

[`register.ts`](doc_src_register_ts.md) tells Windows to run
`vi-torrent "<link>"` when someone clicks a magnet link. That is fine when
nothing is running. When a window **is** open it is not: the
[instance lock](doc_src_instance_lock_ts.md) refuses to let a second process
become a client, on purpose, because two clients sharing one state directory
corrupt each other's downloads.

So the launched process does not try to be a client. It leaves the link in an
inbox directory and exits, and the window already open picks it up on the
1-second refresh tick it was running anyway.

## 2. Why a file and not a socket

The daemon already proves the pattern: **status is a file** rewritten every
second, read synchronously on the TUI's existing tick, precisely so live
progress needs no async plumbing in the render path. A control socket exists
there only because commands are user-initiated and can afford to be async.

A handed-over link is closer to status than to a command: it is one string,
it is not urgent, and it must survive the sender exiting immediately. A file
costs a `readdir` of a near-always-empty directory once a second and adds no
port, no token, and no protocol.

## 3. One path, not two

A cold start could pass the link down into the component tree as a prop
instead. It does not. `index.tsx` drops the link into the inbox in **both**
cases and lets the tick find it:

| Situation | What the launched process does |
| :--- | :--- |
| No window open | Takes the lock, drops the link, starts the TUI; first tick opens it |
| A window is open | Drops the link, prints one line, **exits 0** |

Exiting `0` matters. This is the browser's child process, and a non-zero exit
is how a browser decides a handler is broken.

There is a third entry point, `--handoff`, used only by the windowless shim
in [`register.ts`](doc_src_register_ts.md): it **probes** without acquiring
the lock, drops the link if a window is open, and exits `NO_INSTANCE` (`10`)
if not, leaving the decision to open a terminal to the shim. It never starts
a client, because it is launched hidden and any window it opened would be
invisible.

The cost is that the dialog appears a tick after the UI does, which is
invisible next to the time the renderer takes to start.

## 4. The inbox

Files live in `<stateDir>/inbox/`, named
`<epoch-ms>-<counter>-<pid>.txt`.

- **Timestamp** orders the queue.
- **Counter** is zero-padded to six digits so two links dropped in the same
  millisecond neither collide nor sort out of order. Without it the name is
  `<ms>-<pid>` and a second link from the same process in the same
  millisecond silently overwrote the first. Padding matters: unpadded, `"10"`
  sorts before `"2"`.
- **Pid** separates two different browser clicks landing in the same
  millisecond.

`takeNextLink()` returns **one** link and deletes the file before returning
it. One at a time because there is only one preview dialog; deleting first
because the alternative is adding the same torrent twice if the caller runs
again before the dialog opens.

## 5. Guards

| Guard | Why |
| :--- | :--- |
| `isTorrentArg`: `magnet:` prefix or `.torrent` suffix only | Flags and stray paths on the command line are left alone rather than guessed at |
| `normaliseLink` resolves relative paths | The launching process's working directory is not the running window's; here is the only place that still knows what the path was relative to |
| Links older than 5 minutes are dropped unread | A link only lingers if the window it was meant for died between the pid check and the next tick. Opening a magnet dialog out of nowhere on an unrelated launch days later reads as a bug |
| Unreadable or non-link files are deleted, not skipped | A file that fails the check but stays would be re-examined every second forever |

## 6. Pickup, in `app.tsx`

```ts
const openHandedLink = (): void => {
  if (anyOverlayOpen()) return;
  const link = takeNextLink(handoffDir);
  ...
};
```

Two rules, both deliberate:

- **Never while a dialog is open.** Opening Add on top of Settings throws away
  what the user was doing. The links wait perfectly well.
- **One per tick.** Each opens as soon as the previous is dealt with, which
  makes a queue out of nothing.

## 7. Tested by

`tests/test-handoff.ts`: what counts as a link, relative-path resolution,
drop and pick up, destructive reads, ordering, the stale cutoff, junk files,
and that both sides resolve the same state directory.

`tests/test-handoff-pickup.tsx`: the receiving half, driven through the
**real 1-second tick** rather than by calling the handler directly: a test
that bypassed the tick would pass with the wiring removed. Covers waiting for
an open dialog to close, draining, not re-opening a consumed link, and a
`.torrent` path pointing at a file that no longer exists.

Verified end to end with the **installed binary**, on both paths: handed to a
live instance (`exit 0`, exact content in the inbox) and handed to a cold
start (link dropped before the UI, consumed within the first tick).
