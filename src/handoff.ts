/**
 * Links handed to vi-torrent by the operating system.
 *
 * Clicking a magnet link in a browser, or opening a .torrent file, launches
 * `vi-torrent <link>`. A second window is a legitimate way to run vi-torrent
 * now (see presence.ts) - but opening a brand new terminal window for every
 * link clicked is still worse than handing it to a window already open, when
 * one exists.
 *
 * So the launched process does not try to become a client itself. It writes
 * the link into an inbox directory and exits, and the window that is already
 * open picks it up on the 1-second refresh tick it already runs.
 *
 * This is the same shape as the daemon's status channel: a file on disk, read
 * on an existing tick, rather than a socket and an async protocol. It costs a
 * readdir of a near-always-empty directory once a second.
 *
 * The first-launch case goes through the inbox too, rather than threading the
 * argument down into the component tree. One path instead of two, at the cost
 * of the dialog appearing a tick after the UI does.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { defaultStateDir } from "./state-dir.js";

const INBOX = "inbox";

/**
 * `--handoff` exit code meaning "no window is open, you must launch one".
 *
 * Deliberately not 1. The shim has to tell "nobody is home" apart from a
 * genuine failure, and treating any non-zero as "nobody is home" would open a
 * fresh window every time something went wrong.
 */
export const NO_INSTANCE = 10;

/**
 * Links older than this are dropped unread.
 *
 * A link only lingers if the window it was handed to died between the pid
 * check and the next tick - rare, but the result would be a magnet dialog
 * appearing out of nowhere on some unrelated launch days later, which reads
 * as a bug. Five minutes is long enough to cover a slow start.
 */
const MAX_AGE_MS = 5 * 60 * 1000;

export function resolveStateDir(): string {
  return process.env.VI_TORRENT_STATE_DIR ?? defaultStateDir();
}

/**
 * Is this argument something we can add?
 *
 * Deliberately narrow. Anything else on the command line - flags, a stray
 * path - is left alone rather than guessed at.
 */
export function isTorrentArg(arg: string): boolean {
  if (!arg) return false;
  if (arg.startsWith("magnet:")) return true;
  return arg.toLowerCase().endsWith(".torrent");
}

/**
 * Normalise a link for a reader in a different process.
 *
 * A .torrent path may arrive relative to the launching process's working
 * directory, which the running window does not share. Resolving here is the
 * only place that still knows what it was relative to.
 */
export function normaliseLink(arg: string): string {
  return arg.startsWith("magnet:") ? arg : path.resolve(arg);
}

/**
 * How many links this process has dropped.
 *
 * The timestamp alone is not a unique name: two links dropped in the same
 * millisecond would collide and one would be lost. Padded so the names still
 * sort oldest-first as text, which is how the queue keeps its order.
 */
let dropped = 0;

/** Leave a link for whichever window is open to pick up. */
export function dropLink(stateDir: string, link: string): void {
  const dir = path.join(stateDir, INBOX);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${String(dropped++).padStart(6, "0")}-${process.pid}.txt`;
  fs.writeFileSync(path.join(dir, name), normaliseLink(link), "utf8");
}

/**
 * Take the oldest link waiting, or null.
 *
 * Destructive by design: the file is removed before the link is returned, so
 * a link is added once even if this is called again before the dialog opens.
 * One at a time because there is only one preview dialog - the caller drains
 * the rest on later ticks, once the user has dealt with this one.
 */
export function takeNextLink(stateDir: string): string | null {
  const dir = path.join(stateDir, INBOX);
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return null; // no inbox yet - the normal case
  }

  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const stale = Date.now() - fs.statSync(file).mtimeMs > MAX_AGE_MS;
      const link = fs.readFileSync(file, "utf8").trim();
      fs.unlinkSync(file);
      if (!stale && isTorrentArg(link)) return link;
    } catch {
      // Gone already, or unreadable. Either way it is not ours to add.
    }
  }
  return null;
}
