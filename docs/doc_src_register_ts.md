# Component Spec: `src/register.ts`

**File Path:** [src/register.ts](../src/register.ts)
**Role:** Make Windows hand `magnet:` links and `.torrent` files to vi-torrent.

---

## 1. There is no popup to build

The obvious reading of "make the browser offer to open our app" is that
something must draw a prompt. Nothing does. Browsers generate

> **Open vi-torrent?**  ☐ Always allow

themselves, as soon as the operating system reports a handler for the
`magnet:` scheme. The entire feature is telling Windows that vi-torrent
exists.

## 2. Explicitly run, never on install

```
vi-torrent --register
vi-torrent --unregister
```

Seizing file associations during `bun install -g` would be silent and
surprising, and it is the behaviour that makes torrent clients distrusted. On
a published package it is also the kind of thing that draws scrutiny. It
stays a decision made out loud.

Everything is written under `HKEY_CURRENT_USER`, so it needs no administrator
rights and cannot affect other accounts on the machine.

Handled at the very top of `index.tsx`, before the relaunch check, the
instance lock and the doctor, none of which apply to a command that draws no
UI. Output goes to **stderr**, for the reason the doctor does: importing
`@opentui/core` takes over stdout and patches `console.log` into its own
debug overlay, so anything written to stdout from there never appears.

## 3. What gets written

| Key | Value |
| :--- | :--- |
| `HKCU\Software\Classes\magnet` | `URL:BitTorrent Magnet Link` |
| `HKCU\Software\Classes\magnet` → `URL Protocol` | `""` |
| `HKCU\Software\Classes\magnet\shell\open\command` | `"<exe>" "%1"` |
| `HKCU\Software\Classes\.torrent` | `vi-torrent.torrent` |
| `HKCU\Software\Classes\vi-torrent.torrent` | `BitTorrent file` |
| `HKCU\Software\Classes\vi-torrent.torrent\shell\open\command` | `"<exe>" "%1"` |

`URL Protocol` is the flag that marks the key as a **scheme** rather than a
file type. Without it the handler is ignored outright and the browser reports
no application, an empty value that is not optional.

`.torrent` points at a **ProgID** rather than carrying the command itself. The
extension key is a pointer; owning the thing it points at is what lets
`--unregister` hand it back cleanly.

Written by spawning `reg.exe`. No dependency, and no registry API surface to
get wrong.

## 4. Confirmed, not assumed

`registerHandlers()` reads the magnet command back and compares it to what it
meant to write:

```
expected: "C:\Users\...\vi-torrent.exe" "%1"
stored:   ...
```

`reg.exe` reports success on a command string it has re-quoted into something
Windows cannot launch, and that failure would otherwise surface only as a
browser click doing nothing at all.

## 5. Finding the executable

The registry needs an **absolute path**. A browser launches handlers without
the user's shell PATH in any dependable state, so `vi-torrent` alone would work
from a terminal and fail from Chrome.

`where vi-torrent` is asked first. It is not trusted to be enough:

> `bun install -g` does **not** add its global bin folder to PATH. It prints a
> warning suggesting you do it yourself, which is easy to miss.

That produces a vi-torrent which is genuinely installed and invisible to
`where`, measured on this machine, where `~/.bun/bin` was absent from PATH
while `vi-torrent.exe` sat in it. Refusing to register at that point would be
refusing over a cosmetic problem, since the registry stores an absolute path
and never consults PATH. So Bun's global bin is checked as a fallback, and
only a candidate that **exists on disk** is accepted.

## 6. Unregistering

Deletes only the two keys we created: `magnet` and the `vi-torrent.torrent`
ProgID.

The `.torrent` extension key is deliberately **left alone**. Another client
may have owned it before us, and deleting it would take their association
down with ours. If it still points at our ProgID, the user is told that
Windows will now ask them to choose an application.

## 7. Linux

`desktopEntry()` returns the equivalent `.desktop` file. `MimeType` carries
`x-scheme-handler/magnet` and `application/x-bittorrent`, `Terminal=true`
because this is a TUI. It is printed for the README rather than installed;
`--register` reports that it is Windows-only and points at it.

macOS needs a real `.app` bundle with `CFBundleURLTypes` and is not attempted.

## 8. The windowless shim

`vi-torrent.exe` is a **console** application, so a browser launching it makes
Windows allocate a console: a window flashed even when all that happened was
a link being passed to a session already open. Shipped that way first and
reported immediately.

The registry therefore points at `wscript.exe`, a **GUI-subsystem** host that
allocates no console, running a small VBScript written into the state
directory:

```
"C:\Windows\System32\wscript.exe" "C:\Users\<you>\.vi-torrent\open-link.vbs" "%1"
```

The script runs `vi-torrent --handoff <link>` **hidden** and waits:

| `--handoff` exit | Meaning | Shim does |
| :--- | :--- | :--- |
| `0` | A window was open; the link is in its inbox | nothing; no window ever appears |
| `10` (`NO_INSTANCE`) | Nothing is running | opens a real terminal, visibly |
| `2` | No usable link in the arguments | nothing |

`10` rather than `1` on purpose: the shim must tell "nobody is home" apart
from a genuine failure, or any error would open a fresh window.

`--handoff` **probes** the lock with `instanceHolder()` instead of acquiring
it. This process exits a moment later, and taking the lock would leave a pid
file pointing at a dead process.

The script lives in the state directory, not the package folder: it embeds an
absolute path to the executable and must survive a reinstall. `--unregister`
deletes it. Leaving a script behind that silently launches an application is
exactly what an uninstall should clear away.

**Never a hard dependency.** Windows Script Host can be switched off by
policy, and a handler pointing at a host that will not run is worse than a
console that flashes. If `wscript.exe` is missing, or the script cannot be
written, registration falls back to launching the executable directly and
says so. The success message states which you got:

```
window         none, unless a new one is needed
window         a console flashes briefly
```

### The bug that made this worth a test suite

The first version did not compile. VBScript rejects parentheses on a `Sub`
call whose result is discarded:

```vbs
shell.Run("..." , 1, False)        ' compile error
Call shell.Run("...", 1, False)    ' correct
```

The failure mode is vicious. `wscript` raises a **modal dialog** and waits for
someone to click OK, so clicking a magnet link simply hung, with no console
to show why, and an automated wait hung with it. Reading the script cannot
catch this. Only compiling it can, which is what `tests/test-shim.ts` does by
running the generated source through `cscript` and asserting it reaches its
own no-arguments guard.

## 9. Tested by

`tests/test-shim.ts`: the generated script's content, CRLF line endings
(`wscript` splits on CRLF; a lone-LF file is one giant line), that the
registry entries point at the given launcher, and above all **that it
compiles**.

Registration itself writes to the real registry, so it is verified by running
it: all six values read back correct with quoting intact, the handler
confirmed to exist on disk, and a full `--unregister` → `--register` round
trip. `plannedChanges()` takes the command as an argument so the key set can
be inspected without touching the registry.

End to end, with the installed binary: handed to a live instance (no window,
exact link delivered) and to a cold start (a real window opens, takes the
lock, and consumes the link).
