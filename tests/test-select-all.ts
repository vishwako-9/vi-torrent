import { checks, settle, buildTorrent, addTorrentNow, platformOptions, testRoot } from "./_isolate.js";
/**
 * Include or skip every file at once.
 *
 * The engine half. `setAllFiles` is not a loop over `toggleFile`: that saves
 * the session on every call, so one button press on a torrent with a few
 * thousand files would mean a few thousand synchronous JSON writes.
 *
 * The rule it must not break is the one toggleFile already enforces - a
 * running torrent with nothing wanted just sits there looking broken - so
 * skipping everything keeps exactly one file.
 */
import { Engine } from "../src/engine.js";
import fs from "fs";
import path from "path";

const { ck, done } = checks();

const dir = path.join(testRoot, "selectall");
const TORRENT = await buildTorrent(dir, "bundle", {
  "bundle/one.bin": Buffer.alloc(64 * 1024, 1),
  "bundle/two.bin": Buffer.alloc(64 * 1024, 2),
  "bundle/three.bin": Buffer.alloc(64 * 1024, 3),
});

const engine = new Engine({
  stateDir: process.env.VI_TORRENT_STATE_DIR,
  downloadDir: process.env.VI_TORRENT_DOWNLOAD_DIR,
});

const id = await addTorrentNow(engine, TORRENT);
await settle(async () => {}, 400);

const wantedFlags = () => engine.getFiles(id).map(f => f.wanted);
ck("a fresh torrent wants every file", wantedFlags().every(Boolean));
ck("...and there are three of them", engine.getFiles(id).length === 3);

// --- skip everything: one must survive ---
const skippedCount = engine.setAllFiles(id, false, 1);
ck("skipping everything reports what changed", skippedCount === 2);
const afterSkip = wantedFlags();
ck("the kept file is still wanted", afterSkip[1] === true);
ck("the others are skipped", afterSkip[0] === false && afterSkip[2] === false);
ck("exactly one file survives", afterSkip.filter(Boolean).length === 1);

// --- a second identical call changes nothing ---
ck("re-skipping reports no change", engine.setAllFiles(id, false, 1) === 0);

// --- include everything again ---
ck("including everything reports what changed", engine.setAllFiles(id, true) === 2);
ck("every file is wanted again", wantedFlags().every(Boolean));
ck("including again reports no change", engine.setAllFiles(id, true) === 0);

// --- the survivor is the one asked for, not always the first ---
engine.setAllFiles(id, false, 2);
ck("the survivor is the requested file, not file 0", wantedFlags()[2] === true);
ck("...and file 0 was skipped with the rest", wantedFlags()[0] === false);

// --- an out-of-range keep falls back rather than skipping everything ---
// A panel with a stale cursor must not be able to produce a dead torrent.
engine.setAllFiles(id, true);
engine.setAllFiles(id, false, 99);
ck("an out-of-range keep still leaves one file", wantedFlags().filter(Boolean).length === 1);
ck("...and it is the first", wantedFlags()[0] === true);

// --- it survives a restart, like toggleFile does ---
engine.setAllFiles(id, false, 1);
const index = JSON.parse(fs.readFileSync(
  path.join(process.env.VI_TORRENT_STATE_DIR!, "session.json"), "utf8"));
const entry = (Array.isArray(index) ? index : index.torrents ?? []).find(
  (e: any) => e.skipped?.length);
ck("the skips are persisted", entry !== undefined);
ck("...as the two that were dropped", entry?.skipped?.length === 2);

// --- an unknown torrent is an error, not a silent no-op ---
let threw = "";
try { engine.setAllFiles(9999, true); } catch (e: any) { threw = e.message; }
ck("an unknown torrent id throws", threw.length > 0);

engine.destroy();
done();
