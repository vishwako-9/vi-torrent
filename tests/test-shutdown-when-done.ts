import { addTorrentNow, buildTorrent, checks } from "./_isolate.js";
/**
 * allFinished() - the decision shutdown-when-done relies on to know when the
 * daemon should stop itself. Tested directly on real Engine instances, not
 * through the daemon's HTTP layer (that round trip is proven separately);
 * this is about whether the DECISION itself is right.
 *
 * Deliberately proves the thing this feature is NOT: it does not wait for
 * seeding. seedRatioLimit defaults to 0, which the settings screen itself
 * labels "never stop" - an earlier version of this gated on that setting and
 * would have silently cut off anyone relying on "never stop" meaning what it
 * says. Fixed before shipping; the check below is what catches a regression.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Engine } from "../src/engine.js";

const m = async () => {
  const { ck, done } = checks();

  // --- nothing added: vacuously finished, nothing to wait for ---
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-allfin-empty-"));
  const emptyEngine = new Engine({
    stateDir: path.join(emptyRoot, "state"),
    downloadDir: path.join(emptyRoot, "downloads"),
  });
  ck("an engine with nothing added has nothing to wait for", emptyEngine.allFinished() === true);
  emptyEngine.destroy();

  // --- a torrent with nothing downloaded blocks it ---
  const root1 = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-allfin-partial-"));
  const downloadDir1 = path.join(root1, "downloads");
  const engine1 = new Engine({ stateDir: path.join(root1, "state"), downloadDir: downloadDir1 });
  // Built in a DIFFERENT directory from downloadDir1, so nothing is on disk
  // where the engine will look, and no peers exist either - it genuinely
  // cannot verify as done.
  const partial = await buildTorrent(path.join(root1, "src"), "partial.bin",
    { "partial.bin": Buffer.alloc(64 * 1024, 1) });
  await addTorrentNow(engine1, partial);
  await new Promise(r => setTimeout(r, 800));
  ck("still 0% downloaded", engine1.getTorrents()[0]?.status !== "Done");
  ck("a torrent with nothing downloaded blocks allFinished()", engine1.allFinished() === false);
  engine1.destroy();

  // --- a torrent already complete on disk counts as finished, without seeding ever stopping ---
  // buildTorrent() writes the real file at <dir>/<name> to seed it - adding
  // that same .torrent with downloadDir pointed at the SAME directory means
  // WebTorrent hashes the file already sitting there and verifies it
  // complete on add, with zero peers needed (documented, already-relied-on:
  // "WebTorrent hashes existing data in the save dir on add").
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-allfin-done-"));
  const alreadyThereDir = path.join(root2, "already-there");
  const finished = await buildTorrent(alreadyThereDir, "finished.bin",
    { "finished.bin": Buffer.alloc(64 * 1024, 2) });
  const engine2 = new Engine({ stateDir: path.join(root2, "state"), downloadDir: alreadyThereDir });
  await addTorrentNow(engine2, finished);
  await new Promise(r => setTimeout(r, 1200));
  ck("a torrent already complete on disk reads as Done", engine2.getTorrents()[0]?.status === "Done");
  ck("...and is never paused - shutdown-when-done does not wait for or stop seeding",
    engine2.getTorrents()[0]?.status !== "Paused");
  ck("allFinished() is true with only that (actively seeding, unpaused) torrent present",
    engine2.allFinished() === true);

  // --- the strong version of the above: still true even with a REAL,
  // UNMET ratio target configured. seedRatioLimit=0 alone cannot tell
  // "ignore seeding entirely" apart from "respect the ratio, and 0 means
  // no target" - both agree when the setting is at its default. Only a
  // NON-zero, unmet limit distinguishes them, which is exactly the case
  // the original (rejected) design would have blocked on. ---
  engine2.applySettings({ ...engine2.getSettings(), seedRatioLimit: 5 });
  ck("a configured, un-met seed ratio limit does NOT block it - seeding is genuinely never waited for",
    engine2.allFinished() === true);
  engine2.applySettings({ ...engine2.getSettings(), seedRatioLimit: 0 }); // restore default

  // --- adding a second, unfinished torrent blocks it again ---
  const partial2 = await buildTorrent(path.join(root2, "src2"), "partial2.bin",
    { "partial2.bin": Buffer.alloc(64 * 1024, 3) });
  await addTorrentNow(engine2, partial2);
  await new Promise(r => setTimeout(r, 800));
  ck("a second, unfinished torrent blocks allFinished() even though the first is Done",
    engine2.allFinished() === false);

  // --- a FAILED torrent blocks it too, even with nothing left "downloading" ---
  // Same technique test-rowstate.tsx already uses: emit the error a real
  // torrent would, directly on the live WebTorrent object, rather than
  // constructing a genuinely broken source and waiting on it.
  const target = engine2.getTorrents().find(t => t.name === "partial2.bin");
  const live: any = (engine2 as any).client.torrents.find((x: any) => x.infoHash === target?.infoHash);
  live.emit("error", new Error("simulated failure for allFinished()"));
  await new Promise(r => setTimeout(r, 400));
  ck("the torrent is now reported Failed", engine2.getTorrents()
    .find(t => t.infoHash === target?.infoHash)?.status === "Failed");
  ck("a Failed torrent blocks allFinished() - a failure is not \"done\"",
    engine2.allFinished() === false);

  engine2.destroy();
  await new Promise(r => setTimeout(r, 300));
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
