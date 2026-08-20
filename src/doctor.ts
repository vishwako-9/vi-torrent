/**
 * `bun run doctor` - check the things that break vi-torrent on someone else's
 * machine, and say what to do about each.
 *
 * This exists because every problem found while preparing the first release
 * was environmental rather than a code bug: a native binary that was never
 * downloaded, an installer that reported success without putting anything on
 * PATH, npm cheerfully installing a package it cannot run. None of those
 * produce an error message that names the actual cause.
 *
 * The rule for what belongs here: a check earns its place only if failing it
 * produces a CONFUSING failure. Things that already fail with an obvious
 * message do not need a check.
 */
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { loadSettings } from "./settings.js";
import { defaultStateDir } from "./state-dir.js";

export interface Check {
  name: string;
  ok: boolean;
  /** What was actually found. */
  detail: string;
  /** Only set when !ok: what the user should do. */
  fix?: string;
}

const stateDir = process.env.VI_TORRENT_STATE_DIR ?? defaultStateDir();

/** Can we create this directory and write into it? */
function writable(dir: string): { ok: boolean; detail: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".vi-torrent-write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return { ok: true, detail: dir };
  } catch (e: any) {
    return { ok: false, detail: dir + " - " + (e?.message ?? "not writable") };
  }
}

/**
 * Find bun on the REAL PATH, ignoring project-local shims.
 *
 * The question this answers is "would `bun` work for someone in a fresh
 * shell", not "can this process find a bun binary somewhere".
 */
function bunOnSystemPath(): string | null {
  const separator = process.platform === "win32" ? ";" : ":";
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  for (const dir of (process.env.PATH ?? "").split(separator)) {
    if (!dir || dir.includes("node_modules")) continue;
    try {
      const candidate = path.join(dir, exe);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // An unreadable PATH entry is not an answer either way.
    }
  }
  return null;
}

/**
 * Can the WebRTC transport actually load?
 *
 * Importing it is the honest test - the binary's location differs between a
 * local and a global install, and guessing paths would answer a different
 * question than "will this work".
 */
async function hasWebrtcBinary(): Promise<boolean> {
  try {
    await import("node-datachannel");
    return true;
  } catch {
    return false;
  }
}

/** Is a TCP port free? Resolves rather than throws, so one busy port is not fatal. */
function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    try { server.listen(port, "0.0.0.0"); } catch { resolve(false); }
  });
}

/**
 * Windows refuses paths over 260 characters unless this is on. Torrents nest
 * deeply and are named by strangers, so this is not a theoretical limit - the
 * download fails partway with a path error that reads like a corrupt torrent.
 */
function longPathsEnabled(): boolean | null {
  if (process.platform !== "win32") return null;
  try {
    const out = Bun.spawnSync({
      cmd: ["reg", "query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"],
      stdout: "pipe", stderr: "pipe",
    }).stdout.toString();
    return /0x1\s*$/m.test(out.trim());
  } catch {
    return null; // Cannot tell; do not claim a problem.
  }
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // --- the runtime ---
  const bunVersion = process.versions.bun;
  checks.push({
    name: "Running under Bun",
    ok: !!bunVersion,
    detail: bunVersion ? "Bun " + bunVersion : "not Bun - this is a different runtime",
    fix: "vi-torrent cannot run on Node. Install Bun from https://bun.sh",
  });

  // The failure this machine actually hit: winget reported Bun installed, but
  // created no shim, so `bun` was not a command. An absolute path still works,
  // which is exactly why it is confusing.
  //
  // NOT Bun.which(): bun puts node_modules/.bin at the front of PATH for the
  // scripts it runs, so a local copy - or, as here, a stale shim left behind
  // by a removed dependency - makes this pass while a stranger typing `bun`
  // in a fresh shell still gets "command not found".
  const onPath = bunOnSystemPath();
  checks.push({
    name: "`bun` is on PATH",
    ok: !!onPath,
    detail: onPath ?? "not found by name",
    fix: "Bun may be installed but not on PATH - a winget install can do this. "
      + "Add its folder to PATH, or reinstall from https://bun.sh",
  });

  // --- the native dependency that a global install silently skips ---
  //
  // node-datachannel fetches its prebuilt WebRTC binary from an install
  // script. package.json lists it under trustedDependencies so a normal
  // `bun install` runs that - but a GLOBAL install ignores the field and
  // reports only "Blocked 4 postinstalls", which nobody reads as "this
  // application will not start". Verified by installing the real tarball
  // globally: the binary was absent.
  //
  // The failure it prevents is opaque: "Cannot find module
  // '../../../build/Release/node_datachannel.node'".
  const webrtc = await hasWebrtcBinary();
  checks.push({
    name: "WebRTC native binary",
    ok: webrtc,
    detail: webrtc ? "present" : "missing - torrents cannot connect to peers",
    // NOT `trust --all`: that also runs ip-set's preinstall, which is
    // `npx only-allow pnpm` and exits 1, failing the whole command. Naming
    // the one package that matters avoids it.
    fix: "A global install skips the script that downloads it. Run:\n"
      + "      bun pm -g trust node-datachannel\n"
      + "      (or install from a clone, where `bun install` fetches it)",
  });

  // --- where things get written ---
  const state = writable(stateDir);
  checks.push({
    name: "State directory writable",
    ok: state.ok,
    detail: state.detail,
    fix: "vi-torrent keeps its session here. Check permissions, or set "
      + "VI_TORRENT_STATE_DIR to somewhere writable.",
  });

  const settings = (() => { try { return loadSettings(stateDir); } catch { return null; } })();
  const downloadDir = process.env.VI_TORRENT_DOWNLOAD_DIR
    ?? settings?.savePath
    ?? path.join(os.homedir(), "Downloads", "vi-torrent");
  const dl = writable(downloadDir);
  checks.push({
    name: "Download directory writable",
    ok: dl.ok,
    detail: dl.detail,
    fix: "Downloads land here. Change it in Settings, or set VI_TORRENT_DOWNLOAD_DIR.",
  });

  // --- the network ---
  // 0 is the default and means "let the OS pick", so there is nothing to test
  // - reporting "port 0 is free" would be a check that can never fail.
  const port = settings?.torrentPort ?? 0;
  if (port === 0) {
    checks.push({
      name: "Torrent port",
      ok: true,
      detail: "random (chosen by the OS at startup)",
    });
  } else {
    const free = await portFree(port);
    checks.push({
      name: "Torrent port " + port + " is free",
      ok: free,
      detail: free ? "available" : "already in use",
      fix: "Another BitTorrent client is probably using it. Close it, change "
        + "the port in Settings, or set it back to 0 for a random one.",
    });
  }

  // --- Windows-specific ---
  const longPaths = longPathsEnabled();
  if (longPaths !== null) {
    checks.push({
      name: "Windows long paths enabled",
      ok: longPaths,
      detail: longPaths ? "enabled" : "disabled - paths over 260 characters will fail",
      fix: "Torrents nest deeply and are named by strangers. Enable it (as admin):\n"
        + "      reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem "
        + "/v LongPathsEnabled /t REG_DWORD /d 1 /f",
    });
  }

  return checks;
}

export function formatChecks(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push((c.ok ? "  ok   " : "  FAIL ") + c.name.padEnd(32) + c.detail);
    if (!c.ok && c.fix) lines.push("       -> " + c.fix);
  }
  const failed = checks.filter(c => !c.ok).length;
  lines.push("");
  lines.push(failed === 0
    ? "  Everything checks out."
    : "  " + failed + " problem" + (failed === 1 ? "" : "s") + " above. "
      + "Firewall note: on first run Windows asks whether to allow incoming\n"
      + "  connections - allowing them is what lets peers reach you.");
  return lines.join("\n");
}

// Run directly: `bun run doctor`
if (import.meta.main) {
  console.log("\nvi-torrent doctor\n");
  console.log(formatChecks(await runChecks()));
  console.log();
}
