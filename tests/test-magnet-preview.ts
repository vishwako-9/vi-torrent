import { checks, platformOptions, testRoot } from "./_isolate.js";
/**
 * A MAGNET preview must be able to fetch its own metadata.
 *
 * The whole suite passed while this was broken, because every other test
 * builds a .torrent file - which carries the metadata already. Only a magnet
 * has to ask peers for it, and the preview used to be added `paused`, which
 * makes WebTorrent discard every peer it finds. The Add dialog therefore sat
 * on "Fetching metadata from peers..." forever for every magnet link, and the
 * row showed 0 B until it failed.
 *
 * Runs fully offline against a real tracker on localhost.
 */
import { Server } from "bittorrent-tracker";
import WebTorrent from "webtorrent";
import fs from "fs";
import path from "path";
import { Engine } from "../src/engine.js";

const { ck, done } = checks();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- a real tracker, on localhost ---
const tracker: any = new Server({ udp: false, http: true, ws: false, stats: false });
tracker.on("error", () => {});
tracker.on("warning", () => {});
const port: number = await new Promise(res =>
  tracker.listen(0, "127.0.0.1", () => res(tracker.http.address().port)));
const announce = [`http://127.0.0.1:${port}/announce`];

// --- a seeder holding a two-file torrent, so the file list is worth showing ---
const seedDir = path.join(testRoot, "magnet-seed", "payload");
fs.mkdirSync(seedDir, { recursive: true });
fs.writeFileSync(path.join(seedDir, "one.bin"), Buffer.alloc(96 * 1024, 1));
fs.writeFileSync(path.join(seedDir, "two.bin"), Buffer.alloc(64 * 1024, 2));

const seeder = new WebTorrent({ dht: false, lsd: false, ...platformOptions() } as any);
seeder.on("error", () => {});
const seeded: any = await new Promise(res =>
  seeder.seed(seedDir, { announce } as any, (t: any) => res(t)));

// The magnet carries the infoHash and the tracker - NOT the file list. That
// is the whole point: the file list has to come from the seeder.
const magnet = `magnet:?xt=urn:btih:${seeded.infoHash}`
  + `&dn=payload&tr=${encodeURIComponent(announce[0])}`;
ck("the magnet carries no file list of its own", !magnet.includes("one.bin"));

const engine = new Engine();
engine.onError(() => {});

engine.previewMagnet(magnet);

// Poll rather than sleeping a fixed time: metadata over a loopback tracker is
// quick, but "quick" is not a guarantee.
let preview = engine.getPreview();
for (let attempt = 0; attempt < 60 && !preview?.ready; attempt++) {
  await wait(250);
  preview = engine.getPreview();
}

ck("the preview exists", !!preview);
ck("METADATA ARRIVED for a magnet preview (this is the bug)", preview?.ready === true);
ck("the file list is populated (" + (preview?.files.length ?? 0) + " files)",
  (preview?.files.length ?? 0) === 2);
ck("the size is known, not 0 B", (preview?.size ?? "-") !== "-");

// Fetching metadata must not fetch file data - that is why the preview was
// paused in the first place, and the replacement has to keep that property.
const live: any = (engine as any).client.torrents.find((t: any) => t.infoHash === seeded.infoHash);
ck("no file data was downloaded while deciding ("
    + ((live?.downloaded ?? 0) / 1024).toFixed(1) + " KB)",
  (live?.downloaded ?? 0) === 0);

// --- accepting it must actually start the download ---
// Everything is deselected during preview, so Add has to SELECT what was
// kept; forgetting that would leave the torrent at 0% forever.
engine.confirmPreview([1]); // skip the second file
await wait(600);

const rows = engine.getTorrents();
ck("the torrent is listed after Add", rows.length === 1);
ck("and is no longer a preview", engine.hasPreview() === false);

const files = engine.getFiles(rows[0].id);
ck("the kept file is selected", files[0]?.wanted === true);
ck("the skipped file is not", files[1]?.wanted === false);

// It must make real progress, which is what proves the pieces were selected.
let progressed = false;
for (let attempt = 0; attempt < 40; attempt++) {
  await wait(250);
  if ((engine.getTorrents()[0]?.progressRatio ?? 0) > 0) { progressed = true; break; }
}
ck("the download actually starts after Add (pieces were selected)", progressed);

engine.destroy();
await new Promise(r => seeder.destroy(() => r(null)));
await new Promise(r => tracker.close(() => r(null)));
await wait(300);
done();
