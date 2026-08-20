import fs from "fs";
import os from "os";
import path from "path";

const NEW_DIR_NAME = ".vi-torrent";
const OLD_DIR_NAME = ".vitorrent";

// Runs at most once per process, the first time anything asks for the
// default state dir - not on every call, and never for a caller that
// passes an explicit stateDir or VI_TORRENT_STATE_DIR override, since
// those are never the thing that needs migrating.
let checked = false;

/**
 * The default state directory, after the vitorrent -> vi-torrent rename.
 *
 * Settings, the session index and cached .torrent metadata all live here -
 * unlike the default download folder (which a fresh install can just start
 * fresh with a new name), silently leaving this behind would mean an
 * existing user's saved torrents and preferences simply vanish, with
 * nothing pointing at where they went. Migrated once, in place
 * (`renameSync`, not a copy - instant regardless of how much is cached
 * inside, and never doubles disk usage): if the new directory does not
 * exist yet but the old one does, the old one becomes the new one.
 *
 * Safe if two processes call this near-simultaneously (e.g. a window and
 * the daemon it is about to spawn, both starting around the same time):
 * whichever renameSync loses the race throws ENOENT on the now-vanished
 * source, which is treated the same as "nothing to migrate" - the other
 * process already did it.
 */
export function defaultStateDir(): string {
  const next = newStateDirPath();
  if (!checked) {
    checked = true;
    try {
      const old = path.join(os.homedir(), OLD_DIR_NAME);
      if (!fs.existsSync(next) && fs.existsSync(old)) {
        fs.renameSync(old, next);
        console.error(`vi-torrent: migrated settings from ${old} to ${next}`);
      }
    } catch {
      // Best effort - a failed migration must not stop the app from
      // starting. Worst case the old directory is left in place, untouched,
      // and a fresh one gets created at `next` instead.
    }
  }
  return next;
}

/**
 * The new default path, as a PURE computation - no filesystem access, no
 * migration side effect. For callers that only need the value to COMPARE
 * against (torrent-core.ts's "did this resolve to the real default during a
 * test run" guard), not to actually resolve or use it. Calling
 * defaultStateDir() there instead was a real bug: every Engine constructed
 * under VI_TORRENT_TEST=1 triggered a real migration of the REAL home
 * directory just to build a value for an equality check, regardless of what
 * this.stateDir actually was. Caught by seeing a test run migrate the real
 * ~/.vitorrent - not something reasoned out in advance.
 */
export function newStateDirPath(): string {
  return path.join(os.homedir(), NEW_DIR_NAME);
}
