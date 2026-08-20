#!/usr/bin/env bun
import { render, extend } from "@opentui/solid";
import {
  TextTableRenderable,
  ASCIIFontRenderable,
  InputRenderable,
  SelectRenderable,
} from "@opentui/core";
import { App } from "./app.js";
import { engine } from "./engine.js";

// solid-js maps the "node" export condition to dist/server.js -- its
// server-rendering build, which has NO live reactivity. Bun picks "node" by
// default, so a plain `bun src/index.tsx` renders once and then never
// updates (signals change, the screen does not). Only --conditions=browser
// resolves the reactive build, and bunfig.toml cannot set it (verified:
// [run]/[install]/top-level `conditions` are all ignored).
//
// Rather than depend on the user remembering the flag, detect the bad
// resolution and re-exec ourselves with it. The env sentinel prevents an
// infinite respawn loop if the flag somehow still doesn't take.
const RELAUNCH_SENTINEL = "VI_TORRENT_RELAUNCHED";

// Silent probe-and-drop, run hidden by the shim that browsers actually
// launch (see register.ts). Never draws anything and never starts a client:
// it reports whether a window is open, and if one is, leaves the link for it.
//
// Exits NO_INSTANCE when nothing is running, which is the shim's cue to open
// a real terminal - this process must not do that itself, because it was
// started hidden and the window would be invisible.
if (process.argv.includes("--handoff")) {
  const { dropLink, resolveStateDir, isTorrentArg, NO_INSTANCE } = await import("./handoff.js");
  const { instanceHolder } = await import("./presence.js");
  const link = process.argv.slice(2).find(isTorrentArg);
  if (!link) process.exit(2);
  const stateDir = resolveStateDir();
  // Probed, not registered: this process is about to exit, and registering
  // would leave a marker file pointing at a dead process.
  if (instanceHolder(stateDir) === null) process.exit(NO_INSTANCE);
  dropLink(stateDir, link);
  process.exit(0);
}

// Registering handlers never draws a UI, so it is answered before any of the
// startup machinery below - no relaunch, no instance lock, no doctor.
//
// Output goes to stderr on purpose. Importing @opentui/core (above) takes
// over stdout for the TUI and patches console.log into its own debug overlay,
// so anything written to stdout from here never appears. Same reason the
// doctor warnings use stderr.
if (process.argv.includes("--register") || process.argv.includes("--unregister")) {
  const { registerHandlers, unregisterHandlers } = await import("./register.js");
  const result = process.argv.includes("--register")
    ? registerHandlers()
    : unregisterHandlers();
  process.stderr.write("\n" + result.lines.join("\n") + "\n\n");
  process.exit(result.ok ? 0 : 1);
}

function needsBrowserConditions(): boolean {
  try {
    return Bun.resolveSync("solid-js", import.meta.dir).includes("server");
  } catch {
    return false;
  }
}

if (needsBrowserConditions()) {
  if (process.env[RELAUNCH_SENTINEL]) {
    console.error(
      "vi-torrent: solid-js still resolves to its non-reactive server build\n" +
        "even after relaunching with --conditions=browser. The UI would not\n" +
        "update. Run manually with:\n\n" +
        "  bun --conditions=browser run src/index.tsx\n",
    );
    process.exit(1);
  }
  const child = Bun.spawnSync({
    cmd: [process.execPath, "--conditions=browser", "run", import.meta.path, ...process.argv.slice(2)],
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, [RELAUNCH_SENTINEL]: "1" },
  });
  process.exit(child.exitCode ?? 0);
}

// A second window is legitimate now - both are just clients of the same
// daemon, the same as two browser tabs on one page (see presence.ts for why
// that used to be refused and no longer needs to be). Register this window
// anyway, so the browser handoff below can still tell whether ANY window is
// open and route a clicked link to it instead of opening a new terminal
// every time.
//
// Skipped under VI_TORRENT_TEST: the suites construct several engines on
// purpose, each already isolated to its own temp state directory.
//
// A magnet link or .torrent path handed over by the operating system - what
// the browser's "Open vi-torrent?" prompt launches - arrives as an argument.
//
// It goes into the inbox rather than down into the component tree, which
// keeps ONE path for both cases: a window already open picks it up on its
// refresh tick, and a window starting right now picks it up on its first one.
const { isTorrentArg, dropLink, resolveStateDir } = await import("./handoff.js");
const handedLink = process.argv.slice(2).find(isTorrentArg);

if (process.env.VI_TORRENT_TEST !== "1") {
  const { registerWindow, unregisterWindow } = await import("./presence.js");
  const stateDir = resolveStateDir();
  registerWindow(stateDir);
  if (handedLink) dropLink(stateDir, handedLink);
  // Covers Quit, Ctrl+C, and a closed terminal alike.
  process.on("exit", () => unregisterWindow(stateDir));
}

// Say what is wrong BEFORE the TUI takes the screen.
//
// Nothing printed after this point survives: the renderer switches to the
// alternate screen buffer, so a warning written later is wiped before anyone
// reads it. Silent when everything is fine, which is the normal case.
//
// Skipped under VI_TORRENT_TEST so the suites do not have to answer a prompt,
// and the wait is skipped when stdin is not a terminal - otherwise piping
// output (as the smoke tests do) would hang here forever.
if (process.env.VI_TORRENT_TEST !== "1") {
  const { runChecks, formatChecks } = await import("./doctor.js");
  const failures = (await runChecks()).filter(c => !c.ok);
  if (failures.length > 0) {
    // stderr, deliberately. Importing @opentui/core (above) takes over stdout
    // for the TUI and patches console.log into its own debug overlay, so both
    // console.log and process.stdout.write vanish from here - verified, the
    // warning simply never appeared. stderr is untouched, and is the right
    // stream for a diagnostic anyway.
    const out = (s: string) => process.stderr.write(s + "\n");
    out("\nvi-torrent: this system needs attention\n");
    out(formatChecks(failures));
    if (process.stdin.isTTY) {
      out("\n  Press Enter to start anyway, or Ctrl+C to quit.");
      await new Promise<void>(resolve => {
        process.stdin.resume();
        process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
      });
    }
  }
}

// Torrent downloads keep the event loop alive, so a signal that is not
// converted into a real exit leaves the process running in the background
// still using bandwidth after the UI is gone.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    try { engine.destroy(); } catch { /* never block exiting */ }
    setTimeout(() => process.exit(0), 300);
  });
}

extend({
  table: TextTableRenderable,
  ascii_font: ASCIIFontRenderable,
  input: InputRenderable,
  select: SelectRenderable,
});

// The native render library is NOT set explicitly here. @opentui/core
// resolves it itself from its own optionalDependencies for the running
// platform (@opentui/core-{darwin,linux,win32}-{x64,arm64}). Importing one of
// those directly - which this file used to do - made the package installable
// on Windows x64 and nowhere else.

// engine.ts's singleton is a DaemonEngine here (VI_TORRENT_TEST is unset in
// the real app) - it needs the daemon spawned and its first status snapshot
// published BEFORE App() mounts, because App()'s body reads
// engine.getSettings() synchronously in its very first statements. Silent
// when the daemon starts normally, which is the ordinary case; stderr rather
// than stdout for the same reason as the doctor warning above - stdout is
// already the TUI's by the time this runs.
const daemonOk = await engine.ready();
if (!daemonOk) {
  process.stderr.write(
    "\nvi-torrent: could not start the background daemon - torrents will not download.\n\n",
  );
}

render(() => <App />);
