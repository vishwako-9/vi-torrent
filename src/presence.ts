import fs from "fs";
import path from "path";

/**
 * Track which vi-torrent windows are open against a state directory.
 *
 * Before the daemon-first rewrite this was a LOCK: only one TUI was allowed,
 * because each one wrote session.json directly and two writers racing would
 * corrupt it. That risk is now structurally gone - only the daemon ever
 * writes session.json, no TUI does - so two windows are simply two clients
 * of the same daemon, the same as two browser tabs on one page. Refusing a
 * second window was refusing a case that had already stopped being unsafe.
 *
 * What survives: the browser magnet/.torrent handler (`--handoff` in
 * index.tsx) still needs to know whether ANY window is open, so it can hand
 * a clicked link to one instead of opening a new terminal per click. A
 * single overwritten pid file could only ever remember the MOST RECENTLY
 * launched window, so if that one closed first, a still-open earlier window
 * would stop being found. This is a directory of one marker file per live
 * window instead - correct for any number of windows, not just the last one.
 */
const WINDOWS_DIR = "windows";

function windowsDir(stateDir: string): string {
  return path.join(stateDir, WINDOWS_DIR);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The pid of some OTHER live window, or null if none is open.
 *
 * Prunes dead entries it happens to see along the way - a window that
 * crashed rather than exiting cleanly left its marker file behind, and a
 * crash must never look like a permanently-occupied slot.
 */
export function instanceHolder(stateDir: string): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(windowsDir(stateDir));
  } catch {
    return null; // no directory yet - nobody has ever registered
  }

  let found: number | null = null;
  for (const name of entries) {
    const pid = Number.parseInt(name, 10);
    if (!Number.isFinite(pid)) continue;
    if (pidAlive(pid)) {
      if (pid !== process.pid && found === null) found = pid;
    } else {
      try { fs.unlinkSync(path.join(windowsDir(stateDir), name)); } catch { /* already gone */ }
    }
  }
  return found;
}

/**
 * Every window alive against this state dir right now, this one included -
 * same scan-and-prune as instanceHolder() above, just collecting every live
 * pid instead of stopping at the first OTHER one. Used by the backend-counts
 * sidebar (both the count, via .length, and the actual pids shown next to
 * it), not the --handoff routing instanceHolder() exists for.
 */
export function windowPids(stateDir: string): number[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(windowsDir(stateDir));
  } catch {
    return [];
  }

  const pids: number[] = [];
  for (const name of entries) {
    const pid = Number.parseInt(name, 10);
    if (!Number.isFinite(pid)) continue;
    if (pidAlive(pid)) {
      pids.push(pid);
    } else {
      try { fs.unlinkSync(path.join(windowsDir(stateDir), name)); } catch { /* already gone */ }
    }
  }
  return pids;
}

/** Register this window as open. Always succeeds - there is nothing to refuse. */
export function registerWindow(stateDir: string): void {
  try {
    fs.mkdirSync(windowsDir(stateDir), { recursive: true });
    fs.writeFileSync(path.join(windowsDir(stateDir), String(process.pid)), "");
  } catch {
    // A registry we cannot write to is not a reason to refuse to start - the
    // app still works, it just cannot tell --handoff a window is open.
  }
}

/** Remove this window's marker. Covers Quit, Ctrl+C, and a closed terminal alike. */
export function unregisterWindow(stateDir: string): void {
  try {
    fs.unlinkSync(path.join(windowsDir(stateDir), String(process.pid)));
  } catch {
    // Teardown must never throw.
  }
}
