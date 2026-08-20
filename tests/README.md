# Tests

Run the whole suite:

```
bun run test
```

It prints a per-suite pass count and the total. One file at a time needs the
**`--conditions=browser`** flag explicitly — without it `solid-js` resolves to
its non-reactive server build and everything silently fails to update:

```
bun --conditions=browser run tests/<file>
```

**What each suite covers lives in
[`docs/doc_tests_suite.md`](../docs/doc_tests_suite.md)**, along with the bug
each one exists for. This file is about the rules for *writing* a suite.

> There used to be a table here listing every suite with its exact check
> count. It was wrong within a day of being written — it still described a
> `ctrl+p` palette that had been deleted, and its total was less than half the
> real one. Counts belong in the runner's output, which cannot go stale.

**A suite that emits no checks at all counts as a failure.** A file that fails
to parse produces no `FAIL` lines, so a sweep grepping only for `FAIL` reports
it as green — one suite silently ran zero checks after a refactor and nobody
noticed.

## Terminal size matters

`test-mouse.tsx` needs **44 rows**: with 8 commands the suggestion list is
tall, and at 30 rows the last entries fall off the bottom — which looks like
"the list did not render" rather than "the window is too short". Dump the
frame before believing a missing-element failure.

## Probing colours

`❯` is used by the input prompt, the inline suggestion list, **and** the
settings/theme panel cursors. A top-down scan of `captureSpans()` for it finds
whichever is highest on screen, not the one you meant — scan from the bottom
when you want the input prompt.

## mockInput gotcha

`mockInput.pressKey("down")` sends the literal **text** `"down"`. The arrow
keys need `pressArrow("down")`, and there are `pressEscape()`, `pressEnter()`,
`pressTab()` helpers. Getting this wrong produces failures that look exactly
like broken key routing in the app.

## The ownership invariant

**Ticked (BG) means the daemon owns the torrent and is downloading it.
Unticked means the TUI process owns it.** Exactly one process owns a torrent
at any moment — two clients writing the same files would corrupt the
download. Ticking releases it locally and starts/notifies the daemon;
unticking asks the daemon to release it and re-adds it locally paused. Both
directions are safe only because WebTorrent re-hashes what is already on disk.

Tests must not assume a ticked torrent stays in `client.torrents` — it leaves
almost immediately. Wait for it to reappear as a `remote` row.

## Isolation — read this before adding a suite

Every test **must** start with `import "./_isolate.js";` as its *first*
import. It redirects the engine's session index and download directory into a
temp folder via `VI_TORRENT_STATE_DIR` / `VI_TORRENT_DOWNLOAD_DIR`. ESM
evaluates imports in declaration order, so it only works if it comes first.

Without it a test writes into `~/.vi-torrent` and its throwaway torrents
reappear in the real app on the next launch. An earlier build of this project
had a smoke test rewrite the live app's settings and leave the real client
rate-limited with DHT disabled for days — this is that lesson, enforced.

`Engine` also takes explicit `{ stateDir, downloadDir }`, which is the
cleanest option when a suite needs more than one engine instance
(`test-persistence.ts` does).

`_isolate.ts` additionally sets `VI_TORRENT_TEST=1`, and `Engine`'s constructor
**throws** if it still resolves to the real `~/.vi-torrent` while that is set —
a wrong import order now fails loudly instead of leaking silently. The check
runs before the WebTorrent client is created, otherwise the throw would leave
a live client holding the event loop open and the process would hang rather
than fail.

`test-background.ts` spawns the **real detached daemon**. It shuts it down at
the end, but if you interrupt that suite mid-run, check for a stray with
`Get-Process bun` — the daemon is designed to outlive its parent.

## Notes

- Suites that need a real `.torrent` call `fixtureTorrent()` from
  `_isolate.ts`, which builds one offline from bytes on disk and caches it for
  the run. They used to point at a real Ubuntu torrent sitting outside the
  repo, which meant the suite only ran on the one machine that had it.
- The headless renderer never enters the terminal's alternate screen buffer,
  so **terminal-restore-on-quit cannot be tested here** — it needs a real
  terminal.
- Mouse clicks are driven with `mockMouse` from the same testing kit. Always
  derive click coordinates from the painted frame (`captureCharFrame()`)
  rather than hard-coding them, and assert against **engine state**, not just
  the frame — a click that fires while the UI fails to repaint looks
  identical to a click that never landed. That distinction is what exposed
  the JSX-reactivity bug documented in `src/button.tsx`.
- The torrent table repaints on a 1s timer, so a torrent added directly
  through `engine` (rather than via `/add-file`) is not visible to the UI
  immediately. `test-buttons.tsx` waits it out.
- `Test-Path ~/.vi-torrent` is **not** a valid leak check on a machine where
  the real app is also used — that directory is the app's own live session.
  Rely on the `VI_TORRENT_TEST` guard in `Engine`, which throws, instead.
- A swarm test needs a torrent that is genuinely **incomplete** when the
  session reopens. `test-resume.ts` builds the metadata, destroys the builder
  so nothing is seeding, runs session 1 against an empty swarm, and only then
  brings a seeder up. An earlier version let a 2 MB file finish instantly in
  session 1, so it restored at 100% and the regression check passed
  trivially.
- **Network is not available in every environment** these run in (DHT fails
  to bootstrap with "No nodes to query" and trackers are unreachable). Do not
  write a test that needs real peers. WebTorrent's resume behaviour was
  proven offline instead: build a torrent with `client.seed()`, truncate the
  file in the target directory, re-add, and read the progress. Pass
  `lsd: false` or the seeding and checking clients discover each other on
  localhost and crash during handshake.
- These suites have caught several real bugs, including an assertion that
  checked torrent count synchronously while parsing failed asynchronously,
  and a palette marker string that also matched the main input's placeholder.
  Prefer markers that are genuinely unique to the thing under test.
