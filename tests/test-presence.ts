import { checks, testRoot } from "./_isolate.js";
/**
 * Multiple vi-torrent windows are legitimate now - both just talk to the same
 * daemon, the same as two browser tabs on one page. What survives from the
 * old single-window lock is presence tracking: the browser handoff still
 * needs to know whether SOME window is open, to route a clicked link to it
 * instead of opening a new terminal per click - and, unlike a single
 * overwritten pid file, has to keep working with more than one window open
 * at a time.
 */
import { registerWindow, unregisterWindow, instanceHolder } from "../src/presence.js";
import fs from "fs";
import path from "path";

const { ck, done } = checks();
const dir = path.join(testRoot, "presence-dir");
const windowsDir = path.join(dir, "windows");

// --- registering never refuses ---
registerWindow(dir);
ck("a marker file is written for this window",
  fs.existsSync(path.join(windowsDir, String(process.pid))));
ck("nobody else is registered yet", instanceHolder(dir) === null);

// --- a genuinely live OTHER process is found ---
// Our parent: certainly alive (it is running this test) and certainly not
// us. pid 1 would be the obvious stand-in but does not exist on Windows,
// where the lowest real pid is 4 - a reminder to check the assumption rather
// than the code when a cross-platform test fails.
const otherPid = process.ppid;
ck("there is a live process to stand in for another window",
  Number.isFinite(otherPid) && otherPid > 0 && otherPid !== process.pid);
fs.writeFileSync(path.join(windowsDir, String(otherPid)), "");
ck("a second, live window is found", instanceHolder(dir) === otherPid);

// --- both windows stay discoverable at once, not just the newest ---
// The whole reason this moved from a single pid file to a directory: a
// single file could only ever remember the MOST RECENTLY launched window.
ck("this window's own marker is still there too (not overwritten)",
  fs.existsSync(path.join(windowsDir, String(process.pid))));

// --- a stale marker from a crash is pruned, not mistaken for "someone home" ---
// A pid that cannot exist: Linux caps at 2^22, Windows pids are far lower.
fs.writeFileSync(path.join(windowsDir, "4194305"), "");
ck("a crashed window's stale marker does not count as present",
  instanceHolder(dir) === otherPid); // still finds the real one, not confused by the stale one
ck("...and the stale marker was cleaned up while looking",
  !fs.existsSync(path.join(windowsDir, "4194305")));

// --- unregister removes only our own marker ---
unregisterWindow(dir);
ck("unregistering removes our own marker", !fs.existsSync(path.join(windowsDir, String(process.pid))));
ck("...but leaves the other window's marker alone",
  fs.existsSync(path.join(windowsDir, String(otherPid))));
ck("the other window is still found as present", instanceHolder(dir) === otherPid);

// --- an unwritable state dir must not stop the app starting ---
// Detecting another window is a nicety; refusing to run is not.
const blockedPath = path.join(testRoot, "not-a-dir");
fs.writeFileSync(blockedPath, "i am a file");
let threw = false;
try { registerWindow(path.join(blockedPath, "nested")); } catch { threw = true; }
ck("an unusable registry location still allows startup (no throw)", threw === false);

done();
