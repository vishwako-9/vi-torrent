# The old "Background downloads" README section

This is the exact `## Background downloads` section (and the old `## State`
table rows it affected) from the top-level `README.md`, as it read before
the daemon-first rewrite replaced it with `## The daemon`. Preserved here
for the same reason the code in this folder is — it documents a real,
working design that a lot of this session's hardest bugs came from
understanding, and that is worth being able to read again without a
`git show`.

**This is prose, not code — it describes `src/bg-panel.tsx` and the old
`instance-lock.ts`, both archived alongside it in this same folder (see the
top-level README.md in this directory for what they were).** The handover
concept it describes (ticked = the background process owns a torrent,
unticked = the TUI owns it, "Starting..." during the handoff) is what
`docs/daemon_first_acceptance.md` §1-2 identify as the thing being removed:
two WebTorrent clients - one in the TUI, one in the daemon - that had to
behave identically and were written twice, only one of them ever owning a
given torrent at a time. Real value survived the deletion: the *lesson*
that a background daemon needs to exist as the single owner of every
torrent, not just the ones explicitly handed to it, is exactly what the
daemon-first architecture (`torrent-core.ts` run inside `daemon.ts`, the
TUI as a pure proxy) is built on.

Delete this file at the same time the rest of this archive folder goes -
once nobody needs to compare the old design against the new one anymore.

---

## Background downloads

Tick **BG** on a torrent and it is handed to a detached process that keeps
downloading after you close vitorrent — however you close it, including
killing the terminal. Reopen and the row is still there with live progress and
full control over it; untick to take it back.

The rule is: **ticked means the background process owns it, unticked means the
TUI owns it.** Exactly one process owns a torrent at a time, because two
clients writing the same files would corrupt the download.

Because a background download is invisible by nature, the header line always
names it and its pid while one is running, and it exits the moment it owns
nothing.

**Background ticks survive a restart, so quitting says what will keep going:**

```
vitorrent: 3 torrents will keep downloading in the background.
  - ubuntu-26.04-desktop-amd64.iso
  - debian-13.2.0-amd64-netinst.iso
  - ...
Reopen vitorrent to see them, or untick Background to bring them back.
```

That warning exists because the ticks *persist*. A torrent ticked weeks ago is
still being handed over today, and the whole risk is that it happens without
you noticing. Clearing the ticks on every launch would remove that confusion,
but it would introduce a worse one — open vitorrent to check progress, close
it again, and downloads you expected to continue would silently stop.

**Background opens a dialog** — tick the box and press **Save**. Nothing
happens until you do, and Cancel leaves the torrent alone. Handing a torrent
between processes is not a small operation, and it should not be one stray
click away.

Handing a torrent over takes a moment — it has to be released here before the
other process can take it, or both would write the same files. While that is
happening the row reads **Starting...** and the BG button greys out to
**... handing over**; it comes back as soon as the torrent has an owner again.

A handover never changes whether the torrent is running: tick BG on a
downloading torrent and it keeps downloading in the background; untick it and
it keeps downloading here. A paused one stays paused either way.

**Stop background** releases *every* background torrent at once and shuts the
process down. To reclaim just one, untick its BG box instead.

## State (old rows, since replaced)

Everything lives in `~/.vitorrent`:

| | |
|---|---|
| `session.json` | which torrents you have, and which are ticked for BG |
| `torrents/*.torrent` | cached metadata, so a restart needs no network to resume |
| `settings.json` | your preferences |
| `daemon.json` | the background process's port and auth token, while running |
| `daemon-status.json` | its live progress, rewritten every second |
| `vitorrent.pid` | which window holds the session, so a second one refuses to start |
| `inbox/` | links handed over by the browser, waiting to be picked up |
