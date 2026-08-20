# vi-torrent

[![npm](https://img.shields.io/npm/v/%40vishwanko-9%2Fvi-torrent)](https://www.npmjs.com/package/@vishwanko-9/vi-torrent)
[![license](https://img.shields.io/npm/l/%40vishwanko-9%2Fvi-torrent)](LICENSE)

A BitTorrent client that lives in the terminal, built on
[`@opentui`](https://github.com/sst/opentui) + SolidJS + WebTorrent, running on
Bun.

> **Windows and Linux are verified.** macOS is untested. See
> [Platform support](#platform-support).

<!--
  jsDelivr, version-PINNED, not a relative path, not raw.githubusercontent.com,
  and not `@latest` either - all three tried first and all three real dead
  ends, not guessed around:

  - A relative path (docs/screenshot.png) renders fine on GitHub, but
    npmjs.com's own README renderer (marky-markdown) does NOT serve images
    from the published tarball at all, regardless of what package.json's
    `files` field ships - it unconditionally REWRITES any relative image
    path into a raw.githubusercontent.com URL built from package.json's
    `repository` field. Confirmed via real GitHub issues on npm/marky-markdown
    and npm/www describing this exact behaviour, not assumed.
  - The original absolute raw.githubusercontent.com URL depends on that
    account's GitHub access, which has been unreliable independent of npm.
  - jsDelivr mirrors published npm packages and serves their real tarball
    contents over plain HTTPS, independent of GitHub - but npmjs.com does
    NOT link to jsDelivr directly either: it proxies every external README
    image through GitHub's own `camo.githubusercontent.com`, which caches
    by the exact source URL text for up to 7 days with no public purge API.
    A `@latest` URL never changes its own text between releases, so once
    Camo has cached one screenshot it silently keeps serving that same
    image on every future version bump, jsDelivr purges notwithstanding -
    confirmed firsthand when 0.4.3's corrected screenshots stayed invisible
    on npmjs.com through a jsDelivr purge and repeated hard refreshes, while
    direct fetches of both jsDelivr and the Camo URL already showed the new
    file.

  Pinning to the exact version below means the URL text itself changes on
  every release, so npmjs.com generates a brand-new Camo URL each time -
  one Camo has never cached before - which sidesteps the staleness
  permanently. Costs one line to edit per release when screenshots change.
-->
![vi-torrent downloading a Debian ISO, showing the logo, button row and torrent table with live speed and progress](https://cdn.jsdelivr.net/npm/@vishwanko-9/vi-torrent@0.5.1/docs/screenshot.png)

*Downloading the Debian netinst ISO. The block logo carries a travelling
colour wave, and the dinosaur runs while anything is transferring. The
Backend panel on the right shows the daemon and this window's own pid, and
how many torrents are downloading, see
[the Backend panel](#the-backend-panel). Theme shown is `claude`, the
default; there are twelve.*

## Prerequisites

There is exactly one, and it is not negotiable.

| | Needed? | Why |
|---|---|---|
| **[Bun](https://bun.sh) 1.2+** | **Yes** | The runtime. Everything else follows from it. |
| Windows or Linux | One of them | Both verified, see [Platform support](#platform-support). macOS is untested. |
| Node.js | **No**, and it will not work | See below |
| npm / yarn / pnpm | No | `bun install` does everything |
| Python, a C++ compiler, build tools | No | The one native component ships prebuilt |
| Git | Only to clone | Or download the ZIP from GitHub |
| Admin rights | No | Nothing here needs elevation |

**Node.js genuinely cannot run this.** Not a preference: opentui talks to a
native library over FFI, and its Node build tries to load `node:ffi`, a module
that exists in no Node release. On Node the app starts and renders nothing.

### Installing Bun

**Windows:**

```
winget install Oven-sh.Bun
```

or Bun's own installer:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**Linux and macOS:**

```bash
curl -fsSL https://bun.sh/install | bash
```

Those are different commands, and [bun.sh](https://bun.sh) shows the Unix one
first. On Windows it fails with *"A parameter cannot be found that matches
parameter name 'fsSL'"*, because PowerShell's `curl` is an alias for
`Invoke-WebRequest`. Click the **Windows** tab on that page.

### Then check it actually worked

```
bun --version
```

If that prints a version, you are done. Skip to Installing it.

**If it says "not recognized" or "command not found", Bun installed but is not
on your PATH.** This is common with `winget`, which registers the package
without always creating the shim. It happened on the machine vi-torrent was
built on.

Where Bun actually lands:

| Installed via | Folder |
|---|---|
| `winget` (Windows) | `%LOCALAPPDATA%\Microsoft\WinGet\Links` |
| bun.sh installer (Windows) | `%USERPROFILE%\.bun\bin` |
| `curl \| bash` (Linux, macOS) | `~/.bun/bin` |

**Windows:** find it, then add it permanently. No admin rights needed; this
is your own user PATH:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet" -Filter bun.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName

$dir = "$env:LOCALAPPDATA\Microsoft\WinGet\Links"   # or the folder found above
[Environment]::SetEnvironmentVariable(
  "Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$dir", "User")
```

**Linux and macOS:** the installer usually does this, but if it did not:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc   # or ~/.zshrc
source ~/.bashrc
```

Then open a **new** terminal. PATH changes do not reach shells that are
already running.

### Two warnings you will probably see (Windows)

**"Windows protected your PC" on `bun.exe`.** SmartScreen flags executables it
has not seen often enough to have built a reputation for. It is a popularity
signal, not a malware finding. Click *More info* → *Run anyway* if you are
comfortable; that is your call, not ours. Bun is MIT-licensed and open source
([oven-sh/bun](https://github.com/oven-sh/bun)); just make sure you got it
from `bun.sh` or `winget` and nowhere else, which is the part that actually
matters.

**Your antivirus may flag vi-torrent itself.** A BitTorrent client that opens
network ports and spawns a detached background process looks, to a heuristic
scanner, a bit like something it should worry about. Nothing here is obfuscated
or minified. Every line is in `src/`, and you are welcome to read it before
running it.

Neither of these is something we can fix from our side. Both are your decision;
the app simply will not run if you decline them.

### Is this stack trustworthy?

Reasonable question when an installer warns you. Bun is a mainstream JavaScript
runtime with wide production use, and [`@opentui`](https://github.com/sst/opentui)
is an open-source terminal UI library that other terminal applications are
built on. This project is not the only or the first user of either. Both are
MIT-licensed. Every dependency, its licence and its source repository is listed
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

None of that obliges you to install anything. It is offered so you can decide
with the actual facts.

## Platform support

| | |
|---|---|
| **Windows** | Verified: full suite from a clean clone, CI on a fresh Windows runner, and the app runs. Tested on x64; ARM64 untested but not blocked. |
| **Linux** | Verified: the full suite, a real launch, and the **global install below run start to finish**, on Ubuntu 26.04 (x86_64). Tested under WSL2, which runs a genuine Linux kernel; other distributions should behave the same but have not been checked. |
| **macOS** | **Untested.** No machine was available. It takes the same code path as Linux, so it is expected to work, but that is an expectation and not a measurement. Reports welcome. |

### uTP is disabled off Windows, and why

BitTorrent has two transports: TCP, which every peer speaks, and uTP, a
congestion-control layer on top. uTP comes from `utp-native`, a NAPI module,
and NAPI on POSIX is still being completed in Bun. Loading it there does not
throw. It takes the process down:

```
panic(main thread): unsupported uv function: uv_timer_init

Bun is actively working on supporting all libuv functions for POSIX
systems, please see this issue to track our progress:

https://github.com/oven-sh/bun/issues/18546
```

That is Bun's own message and its own tracking issue; the work is in progress
upstream.

So `src/webtorrent-platform.ts` passes `utp: false` everywhere except Windows,
where uTP works and is kept. Measured on Ubuntu 26.04:

| | |
|---|---|
| `new WebTorrent()` | panics within seconds |
| `new WebTorrent({ wrtc: false })` | panics: **WebRTC was never the cause** |
| `new WebTorrent({ utp: false })` | 55 peers, 642 MB at 11 MB/s in the first minute |

Losing uTP costs little in practice: TCP is universal, and uTP mainly improves
how politely a client shares a congested link.

When that upstream work lands, the guard can simply be deleted.

## Installing it

Three steps, and **none of them are optional**. Each is followed by what it
looks like when it worked, so you can tell where you are if something goes
wrong. These were run start to finish on both Windows 11 and Ubuntu.

### Step 1: install the package

```
bun install -g @vishwanko-9/vi-torrent
```

You should see:

```
installed vi-torrent with binaries:
 - vi-torrent

Blocked 1 postinstall. Run `bun pm -g untrusted` for details.
```

**That "Blocked" line is a problem, not a footnote.** Step 2 fixes it.

### Step 2: let the WebRTC binary download

```
bun pm -g trust node-datachannel
```

You should see `1 script ran across 1 package`.

WebTorrent's WebRTC transport fetches a prebuilt native binary from an install
script, and Bun blocks dependency scripts by default. This package lists it
under `trustedDependencies`, which covers a normal `bun install`, but a
**global** install ignores that field and only prints `Blocked 1 postinstall`,
which does not read as "this will not be able to reach any peers".

Skip it and the app still starts; torrents just never connect. `bun run
doctor` detects exactly this and prints the command back at you.

Use `trust node-datachannel`, **not `trust --all`**: the latter also runs
`ip-set`'s install script, which is `npx only-allow pnpm`, exits 1, and fails
the whole command.

To confirm the binary actually arrived:

```
# Linux / macOS
ls ~/.bun/install/global/node_modules/node-datachannel/build/Release/

# Windows PowerShell
dir "$env:USERPROFILE\.bun\install\global\node_modules\node-datachannel\build\Release"
```

There should be a `node_datachannel.node` of roughly 7–9 MB.

### Step 3: put it on your PATH

**`bun install -g` does not do this for you.** It prints a warning and carries
on, which is easy to miss:

```
warn: To run "vi-torrent", add the global bin folder to $PATH:
C:\Users\<you>\.bun\bin
```

Without it, `vi-torrent` is "not recognized" / "command not found" even though
the install succeeded.

**Linux and macOS:** add it to your shell profile, then open a new terminal:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc     # or ~/.zshrc
```

**Windows:** *Settings → System → About → Advanced system settings →
Environment Variables → Path → New*, add `C:\Users\<you>\.bun\bin`, then open
a new terminal.

> Do **not** use `setx PATH "%PATH%;..."` for this. `setx` truncates at 1024
> characters and `%PATH%` is the combined machine+user value, so on a typical
> machine it both loses entries and duplicates the system ones into your user
> PATH. If you want to script it, use PowerShell:
>
> ```powershell
> $bin  = "$env:USERPROFILE\.bun\bin"
> $user = [Environment]::GetEnvironmentVariable('PATH','User')
> if (($user -split ';') -notcontains $bin) {
>   [Environment]::SetEnvironmentVariable('PATH', "$user;$bin", 'User')
> }
> ```

Check it worked **in a new terminal**. An existing one still has the old
environment:

```
vi-torrent
```

If some other launcher on your PATH is also called `vi-torrent`, the first one
wins. `command -v vi-torrent` (Linux/macOS) or `(Get-Command vi-torrent).Source`
(Windows) tells you which you are actually getting.

### From source instead

```
git clone https://github.com/vishwako-9/vi-torrent.git
cd vi-torrent
bun install
bun start
```

No trust step and no PATH step: `trustedDependencies` works for a normal
install, so the WebRTC binary is fetched automatically, and `bun start`
already passes the flag the app needs. `bun install` takes about a minute the
first time.

### What each install actually runs

These are two genuinely separate copies of the app, and it matters which one
you are running:

| | What it runs | Updates when... |
|---|---|---|
| **Global** (`bun install -g @vishwanko-9/vi-torrent`) | A **built, bundled copy** (`dist/`) | ...you `bun install -g @vishwanko-9/vi-torrent` again, or reinstall from a fresh build |
| **From source** (`bun start` / `bun --conditions=browser run src/index.tsx`) | The **live `src/`** directly, on every launch | ...automatically, the moment you save a file |

**This matters for `--register`.** Clicking a magnet link or a `.torrent`
file always launches the **globally installed** copy, that is the one
Windows or your desktop environment points at, regardless of which one you
normally type `vi-torrent` to run. If you develop from source and rebuild
occasionally, the file-click handler can silently be running an **older**
build than the one you have been testing, showing older behaviour with no
warning that it is out of date. There is no automatic link between the two:
rebuilding `src/` does not touch the global install, and reinstalling
globally does not touch your source checkout. Keep them in sync deliberately:
after a source change you want the file handler to reflect, rebuild
(`bun run build`) and reinstall (`bun install -g` from the built package)
before relying on double-click behaviour again.

## Running it

```
bun start
```

Or directly:

```
bun --conditions=browser run src/index.tsx
```

**The `--conditions=browser` flag is not optional.** `solid-js` maps the
`"node"` export condition to its server-rendering build, which has no
reactivity: signals update and the screen never does. `bunfig.toml` cannot
set it (verified: `[run]`, `[install]` and top-level keys are all ignored), so
the launcher passes it explicitly and `src/index.tsx` re-execs itself with it
as a fallback.

Once installed globally, the command takes a few arguments:

| | |
|---|---|
| `vi-torrent` | open the client |
| `vi-torrent "magnet:?xt=..."` | open it with that magnet ready to add |
| `vi-torrent path/to/file.torrent` | same, from a file |
| `vi-torrent --register` | let your browser hand magnet links over, see below |
| `vi-torrent --unregister` | undo that |

Multiple windows can be open at once. They share one background process, so
they always show the same torrents. A magnet or file handed over by the
browser still goes to a window that is already open rather than starting a
new one, purely so clicking a link does not spawn a fresh terminal every
time; opening `vi-torrent` yourself a second time on purpose works fine too.

## Opening magnet links from your browser

Clicking a magnet link, or opening a `.torrent` you downloaded, can hand it
straight to vi-torrent, the same way a desktop client does.

```
vi-torrent --register
```

Your browser then asks **"Open vi-torrent?"** the first time. Tick *Always
allow* and it stops asking. Undo it with `vi-torrent --unregister`.

There is no separate helper app: the browser generates that prompt itself as
soon as Windows reports a handler for the `magnet:` scheme, and this is what
registers one.

**What it changes.** Six values under `HKEY_CURRENT_USER\Software\Classes`:
the `magnet:` protocol and a `.torrent` file association, both pointing at
your installed `vi-torrent.exe`. It needs no administrator rights and cannot
affect other accounts on the machine. It is a command you run on purpose,
never something the installer does behind your back.

**If a window is already open**, the link is handed to it rather than
starting a new terminal for every click. Either way the torrent appears in
the Add dialog, so you still choose the files before anything downloads.

**If another client already owns these**, Windows keeps its choice: it
protects whichever application you picked with a signature that cannot be
overwritten programmatically. Registering makes vi-torrent selectable, and you
switch in *Settings → Apps → Default apps*, or right-click a `.torrent` →
*Open with* → *Always use this app*.

**Linux** uses a `.desktop` file rather than the registry. `--register` says
so and points here. Drop this in
`~/.local/share/applications/vi-torrent.desktop`, adjusting the path, then run
`update-desktop-database ~/.local/share/applications`:

```ini
[Desktop Entry]
Type=Application
Name=vi-torrent
Comment=BitTorrent client in the terminal
Exec=/home/you/.bun/bin/vi-torrent %u
Terminal=true
MimeType=x-scheme-handler/magnet;application/x-bittorrent;
Categories=Network;FileTransfer;
```

macOS needs a signed `.app` bundle to register a URL scheme, which this
project does not build.

**On WSL2 the `.desktop` file does nothing useful.** Your browser runs on
Windows, so a magnet click goes to the Windows handler and the Windows copy of
vi-torrent. The Linux one inside WSL is never involved. The two installs are
completely separate: separate Bun, separate PATH, separate `~/.vi-torrent`, and
separate settings. Register on the Windows side.

## If something goes wrong

```
bun run doctor
```

It checks Bun's version, whether `bun` is genuinely on PATH, whether the state
and download directories are writable, the torrent port, and Windows long-path
support, and prints what to do about anything that fails.

**vi-torrent runs these checks itself at startup** and says nothing unless one
fails, so you do not need to remember this command. It only ever *reports*;
it never installs, downloads or changes a setting on your machine.

Two more things it cannot check for you:

| | |
|---|---|
| **A torrent shows `seeders ?` / `leechers ?` in the Add dialog** | Those two numbers come only from a tracker's own announce reply. They are not the same signal as `connected`, which comes from DHT/PEX and works independently. A `?` means the trackers listed in that specific magnet have not answered yet, which is completely normal churn on today's public tracker ecosystem: re-tested on Windows with a batch of real trackers and most `https://` ones answered with real data in seconds, so this is not a Bun or platform limitation. It is cosmetic: DHT/PEX keeps finding peers and the download proceeds regardless of whether any tracker ever answers. |
| **A torrent finds genuinely no peers and stays on `Metadata...`** | Rarer than the above. Means DHT/PEX are not finding anyone either, not just that a tracker is quiet. Check the Windows firewall prompt below first. |
| **Windows firewall prompt on first run** | Allow it. Denying does not break vi-torrent, but incoming peer connections are blocked, so downloads will be slower. |
| **Long paths** | Torrents nest deeply and are named by strangers, and Windows rejects paths over 260 characters unless long-path support is on. The doctor checks this one and prints the exact `reg add` line. That fix does need admin, and it is the only thing here that does. |

## Using it

Every action has a button. Click a row to select it, then click an action.
Typing `/` opens a command list you can arrow through or click.

| Command | |
|---|---|
| `/add-magnet <uri>` | add from a magnet link |
| `/add-file <path>` | add from a `.torrent` file |
| `/pause` `/resume` `/remove` `[id]` | act on the ticked torrents, or the cursor row |
| `/select-all` `/select-none` | tick every torrent, or clear the ticks |
| `/details` | files and peers for the selected torrent |
| `/theme [name]` | claude, nord, gruvbox, dracula, matrix, tokyo, catppuccin, solarized, light, darkplus, neon, mono |
| `/settings` | speed limits, connections, DHT, encryption, port, see [when a change takes effect](#when-a-setting-takes-effect) |
| `/shutdown-daemon` | stop the background process **and** close this window (type twice to confirm), see [the daemon](#the-daemon) |
| `/shutdown-when-done` | toggle: stop the background process once every torrent finishes downloading |
| `/quit` | close this window; the background process keeps running |

**Remove + Files** needs two clicks. The second one deletes the downloaded
data, and that is irreversible.

## Acting on several torrents at once

The **SEL** column is a checkbox. Click a row to tick it, click again to untick,
or use the **All** and **None** buttons. Then press Pause, Resume, Remove, or
Remove + Files **once** and it applies to everything ticked.

Nothing is ticked when you open vi-torrent. The app should not arrive with an
action already armed.

**With nothing ticked, actions apply to the row your cursor is on.** So the
single-torrent workflow is unchanged: arrow to a torrent, press Pause, done.
You only tick things when you want more than one.

| | |
|---|---|
| Click a row | ticks it *and* moves the cursor there |
| Arrow keys | move the cursor **without** ticking, so you can look around |
| `All` / `None` | tick everything / clear |
| SEL header | shows the number ticked, so you can see what an action will hit |

The command input always has the keyboard, so the space bar types a space
rather than ticking a row. `/select-all` and `/select-none` are the keyboard
route.

**Remove + Files still needs two clicks**, and it names the number:
*"Click again: delete 7 + files"*. Changing the selection between the two
clicks disarms it, because deleting a set you did not confirm is the one
mistake here that cannot be undone.

**Shutdown daemon** also needs two clicks, for a different reason: it stops
the background process for **every** window watching it, not just this one.
See [the daemon](#the-daemon).

## When a setting takes effect

Not all of them behave the same way, so the panel labels the two that don't.

![the Settings panel, listing theme, speed limits, connections, sequential download, seed ratio, DHT, encryption, listen port and port forwarding](https://cdn.jsdelivr.net/npm/@vishwanko-9/vi-torrent@0.5.1/docs/screenshot-settings.png)

| | |
|---|---|
| **Immediately, including torrents already running** | Download limit, Upload limit, Max connections, Seed ratio limit, Theme |
| **New torrents only** (marked `(new torrents)`) | Save path, Sequential download |
| **Next launch** (marked `(next launch)`) | DHT, Peer exchange, Local discovery, Encryption, Listen port, Port forwarding |

**Immediately** means what it says: change the download limit mid-transfer and
the running torrents slow down at once. Max connections gates *new* peer
connections. It does not disconnect peers you already have, so lowering it
takes effect as peers turn over rather than instantly.

**New torrents only** is not the same as "next launch". The save path and
sequential mode are read when a torrent is *added*, so restarting will not
apply them retroactively either: anything already in your list keeps the
values it was added with.

**Next launch** ones are fixed when the BitTorrent client object is
constructed and cannot be changed on a live client. The panel marks these, and
saving tells you a restart is needed.

## Choosing files

Adding a torrent opens a dialog first, nothing downloads while you decide.
Every file is listed with its size and a checkbox; untick what you don't want
and press **Add**. Unticked files are deselected *before* the torrent starts,
so their data is never fetched rather than fetched and ignored. You can also
change your mind later in **Details**.

![the Add dialog, showing a torrent's file list, size and live tracker counts before anything downloads](https://cdn.jsdelivr.net/npm/@vishwanko-9/vi-torrent@0.5.1/docs/screenshot-add.png)

**All** and **None** are there for the common case: on a big torrent, press
**None** and tick the two files you actually want, rather than unticking
forty. Both dialogs have them.

> These pick **files inside one torrent**. The All / None buttons on the main
> screen pick **torrents**, see
> [acting on several torrents at once](#acting-on-several-torrents-at-once).

The Add dialog lets you empty the selection completely, that is the point of
**None**, and refuses only when you press **Add**, since a torrent with
nothing wanted would sit there doing nothing. In **Details**, on a torrent
that is already running, **None** keeps the file the cursor is on (the row
marked `❯`) so the torrent always has something to download.

![the Details panel, showing a finished torrent's file and real connected peers by address and transport](https://cdn.jsdelivr.net/npm/@vishwanko-9/vi-torrent@0.5.1/docs/screenshot-done.png)

**Progress counts only the files you kept.** Skip half a torrent and it still
reaches 100% and turns green when the files you asked for are done. The
percentage answers "is my download finished", not "how much of this torrent
exists".

One caveat worth knowing: BitTorrent pieces don't respect file boundaries, so
the first and last pieces of a skipped file may still arrive because a
neighbouring file needs them. Skipping saves most of a file's data, not
strictly all of it.

## What the Status column means

| | |
|---|---|
| `Metadata...` | Fetching the file list from peers. A magnet link carries only a hash, so this comes before anything can download: the size reads `0 B` until it arrives. |
| `Downloading` | Actually transferring. |
| `Paused` | You paused it, or it was restored from your last session. |
| `Done` | Every file you kept is complete. Skipped files do not hold it back. |
| `Failed` | Something went wrong. Open **Details**, which leads with the reason. |

A finished torrent takes a faint green wash across the whole row, and a failed
one a faint red, the way a diff marks added and removed lines.

## The daemon

The window you type into is not what downloads anything. It is a client of a
separate background process, the **daemon**, which owns every torrent from
the moment you add it. This is why closing the window, however you close it
(Quit, Ctrl+C, killing the terminal), never stops a download: the daemon is
a different process and was never told to stop.

The daemon starts itself the first time you run `vi-torrent`, if none is
already running, and stays running after you close the window. Run
`vi-torrent` again later, from the same window or a new one, and it connects
to that same daemon rather than starting a second one, so several windows
always show the same torrents, live.

**Nothing stops it automatically.** There is no idle timer: a daemon holding
zero torrents keeps running exactly as it would holding twenty. Three ways
to actually stop it:

| | |
|---|---|
| **Quit** (or Ctrl+C, or closing the terminal) | Closes this window only. The daemon and every download keep going. |
| **Shutdown daemon** | Stops the daemon **and** this window together, the way turning off a computer takes the screen with it, not the backend dying while a dead window stays on screen. Two clicks (or type `/shutdown-daemon` twice): the first names what it does, *"Stops ALL downloads in every window, and closes this window too"*, the second confirms. Stops every torrent in every window watching this daemon, not just the one that clicked. |
| **Shutdown when done** | A toggle, not an immediate action: arm it (button or `/shutdown-when-done`) and the daemon watches on its own, entirely independent of whether any window is open, and stops itself once every torrent has finished **downloading**. It does not wait for seeding, and it does not remove anything. Torrents just come back paused, with accurate progress, next time you open vi-torrent. Reopening a window while it is still watching does not cancel it; the button shows whether it is currently armed, and you turn it off the same way you turned it on. |

**Torrents always come back paused**, never resumed silently, whether the
daemon exited cleanly or was killed outright (including as an OS shutting
down force-killing it, which does not run any cleanup code at all). Nothing
is lost either way: progress is never trusted from a cache, it is
re-verified by hashing whatever bytes are actually on disk, so an abrupt
kill can cost at most the one piece being written at that exact instant,
self-healing on the next launch, not a corrupted download.

### The Backend panel

The box on the right shows what is actually running behind this window:
the daemon's pid, the pid of every open window (this one marked `(C)` and
listed first), and how many of the current torrents are downloading. It is
a read of state that already exists; nothing new is tracked to show it.

Opening several windows over time (a few clicked links, a shortcut used
more than once) is completely normal and never refused, but it is easy to
lose track of how many you have open. At 3 or more, the panel adds a line
naming how many others are open and suggesting you close the extras; it is
only a nudge, never automatic. vi-torrent will not close a window for you.

## State

Everything lives in `~/.vi-torrent`:

| | |
|---|---|
| `session.json` | which torrents you have, and their per-file skip settings, written and owned by the daemon only |
| `torrents/*.torrent` | cached metadata, so a restart needs no network to resume |
| `settings.json` | your preferences |
| `daemon.json` | the daemon's port and auth token, while it is running |
| `daemon-status.json` | its live progress, rewritten every second |
| `windows/` | one empty marker file per open window, so a browser-clicked link can find one to hand itself to (not a lock; several windows are fine) |
| `inbox/` | links handed over by the browser, waiting to be picked up |

The session index is rewritten whenever it changes, not on exit, so a crash
loses nothing. Torrents come back **paused**: closing the app never silently
resumes downloads behind your back.

Downloads go to `~/Downloads/vi-torrent` by default; change it in Settings.

## Layout

```
src/
  index.tsx          entry point, the --conditions guard, signal handling
  app.tsx            the whole UI
  engine.ts          picks the daemon-backed engine, or the in-process one under test
  torrent-core.ts     the real WebTorrent engine - runs inside the daemon
  daemon.ts          the background process: owns torrent-core.ts, exposes it over HTTP
  daemon-client.ts   reads its status from a file, sends commands over HTTP
  daemon-engine.ts   TUI-side proxy with torrent-core.ts's exact method signatures
  presence.ts        tracks which windows are open, for the browser handoff below
  overlay.tsx        the shared dialog frame and key router
  add-panel.tsx      Add: inspect a torrent, pick its files, add or cancel
  detail-panel.tsx   per-torrent files and peers, with per-file skip
  settings.ts        what is persisted; settings-panel.tsx renders it
  theme.ts           palettes; the live one is a mutable shared object
  format.ts          sizes, speeds, progress bars, progress over kept files
  button.tsx         the borderless one-row button chip
  logo.ts            per-column logo cells and the colour wave
  avatar.ts          the pixel dinosaur
  keyboard-utils.ts  intercepting keys on a focused input
  remove-folder.ts   the guarded folder cleanup for Remove + Files
  rediscover.ts      forces a re-announce after un-pausing
  handoff.ts         links handed over by the browser, and picking them up
  doctor.ts          environment checks, run on startup and via `bun run doctor`
tests/               `bun run test` - see tests/README.md
```

**Only `torrent-core.ts` constructs a WebTorrent client, and only the daemon
process ever runs it.** `app.tsx` talks to `engine`, which is one of two
interchangeable implementations picked at import time. It has no idea, and
does not need to know, whether it is talking to the real thing in-process
(tests) or a daemon over HTTP (everywhere else).

## Small terminals

The window adapts rather than breaking. Under 20 rows the logo and avatar are
dropped so the table and the prompt keep their space; the button row wraps
instead of running off the right edge; and the table clips and scrolls inside
its frame, so a long torrent list can never paint over the prompt. Enlarge the
window and the header comes back.

## Deeper documentation

This file is the entry point. Full documentation lives in
[`docs/`](docs/), start at [`docs/navigation_map.md`](docs/navigation_map.md)
for the sitemap, or [`docs/master_architecture_spec.md`](docs/master_architecture_spec.md)
for the architecture. There is a per-module spec for each file in `src/`.

## Built with

| | |
|---|---|
| [Bun](https://bun.sh) | Runtime, package manager, bundler and test runner |
| [`@opentui/core`](https://github.com/sst/opentui) + `@opentui/solid` | Terminal UI: layout, renderables, native rendering over FFI |
| [SolidJS](https://www.solidjs.com) | Signals and effects |
| [WebTorrent](https://webtorrent.io) | BitTorrent engine |
| TypeScript | |
| GitHub Actions | CI on a clean Windows runner |

Licences for every dependency are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

### Tools used

Built, tested and released by one person, who found essentially every bug in
this project by running it and watching what it did: magnet links that never
worked, a metadata cache that poisoned itself, two windows quietly corrupting
each other. None of that was visible in the code.

AI coding tools were used during development, the way an editor or a linter
is a tool, not a collaborator:

| Tool | Model | Used for |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | Sonnet 5, Opus 5 | Most of the code, the tests and the documentation |
| Codex CLI | GPT-5.5 | Bug review |
| Antigravity | Gemini 3.6 Flash | Code and documentation |

## Licence

MIT, see [LICENSE](LICENSE). Third-party components and their licences are
listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

vi-torrent is a BitTorrent client: a general-purpose file transfer tool. What
you download with it is your responsibility.

## Notes for anyone changing this

**JSX here is not reactive.** `tsconfig.json` uses `"jsx": "react-jsx"` with
opentui's automatic runtime rather than `babel-preset-solid`, so props are
evaluated once into a plain object with no getters. Every dynamic value must
be driven imperatively through a ref inside a `createEffect`. Writing
`<text>{someSignal()}</text>` paints the first value and never updates again,
which once silently broke a delete confirmation.

**A focused input swallows every keystroke** before any global handler sees
it, so shortcuts are intercepted on the instance (`keyboard-utils.ts`).

**WebTorrent discards peers found while a torrent is paused,** and `resume()`
does not re-announce, so resuming without `rediscover()` sits at zero peers
until the tracker's next announce, often half an hour.

**Only the table may absorb a size change.** It can scroll; everything else
just disappears when squeezed, so the prompt, error line and suggestion list
are all `flexShrink={0}`.

Run the whole suite with `bun run test`, **not** `bun test`, which is Bun's
own runner and finds nothing here. One file at a time is
`bun --conditions=browser run tests/<file>`. `tests/README.md` explains the
isolation rules, which are not optional: an unisolated test writes into your
real session.
