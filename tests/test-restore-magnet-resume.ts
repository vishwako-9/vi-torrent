import { checks, platformOptions, testRoot } from "./_isolate.js";
/**
 * A magnet restored WITHOUT cached metadata must resolve when resumed.
 *
 * This is the state a session lands in after the metadata-stub bug is
 * cleaned up: the session index knows the magnet URI, there is no usable
 * .torrent on disk, and restore() adds it paused. It shows 0 B and "Paused",
 * which is honest - but Resume then has to actually work, or those rows are
 * dead weight forever.
 *
 * Worth its own suite because a paused torrent cannot fetch metadata at all
 * (WebTorrent discards peers found while paused), so everything depends on
 * rediscover() forcing a fresh announce on resume.
 *
 * Runs offline against a real tracker on localhost.
 */
import { Server } from "bittorrent-tracker";
import WebTorrent from "webtorrent";
import fs from "fs";
import path from "path";
import { Engine } from "../src/engine.js";

const { ck, done } = checks();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const stateDir = process.env.VI_TORRENT_STATE_DIR!;

// --- a real tracker and seeder on localhost ---
const tracker: any = new Server({ udp: false, http: true, ws: false, stats: false });
tracker.on("error", () => {});
tracker.on("warning", () => {});
const port: number = await new Promise(res =>
  tracker.listen(0, "127.0.0.1", () => res(tracker.http.address().port)));
const announce = [`http://127.0.0.1:${port}/announce`];

const seedDir = path.join(testRoot, "rm-seed", "payload");
fs.mkdirSync(seedDir, { recursive: true });
fs.writeFileSync(path.join(seedDir, "a.bin"), Buffer.alloc(128 * 1024, 3));

const seeder = new WebTorrent({ dht: false, lsd: false, ...platformOptions() } as any);
seeder.on("error", () => {});
const seeded: any = await new Promise(res =>
  seeder.seed(seedDir, { announce } as any, (t: any) => res(t)));

// --- a session that knows only the magnet, exactly like the cleaned-up one ---
const magnet = `magnet:?xt=urn:btih:${seeded.infoHash}`
  + `&dn=payload&tr=${encodeURIComponent(announce[0])}`;
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, "session.json"), JSON.stringify([{
  infoHash: seeded.infoHash,
  magnetURI: magnet,
  savePath: path.join(testRoot, "rm-down"),
  name: "payload",
  length: 0,          // unknown - this is the point
  background: false,
}], null, 2));
ck("no cached metadata exists for it",
  !fs.existsSync(path.join(stateDir, "torrents", seeded.infoHash + ".torrent")));

const engine = new Engine();
engine.onError(() => {});
const restored = engine.restore();
await wait(1200);

ck("it is restored", restored === 1 && engine.getTorrents().length === 1);
const row = engine.getTorrents()[0];
ck("restored PAUSED, as every restored torrent is", row?.status === "Paused");
ck("with no size yet, which is honest", row?.size === "-" || row?.size === "0 B");

// --- Resume must make it resolve ---
engine.resume(row.id);

/**
 * How long to wait for metadata to arrive over a real localhost swarm.
 *
 * This is not a fixed sleep - it polls and stops as soon as the size is
 * known, so the normal case costs a second or two. The bound only matters
 * when something is wrong, and it has to cover the slow case: a tracker
 * announce plus a peer handshake plus a metadata exchange, on a machine that
 * has just run forty other suites.
 *
 * 15s was enough running this suite alone and NOT enough inside the full
 * sweep, where it failed roughly one run in three, taking the four
 * metadata-dependent checks with it. Raised rather than removed, because the
 * assertion is worth keeping strict - and the elapsed time is reported so a
 * future failure says whether it was close or nowhere near.
 */
const METADATA_BUDGET_MS = 45_000;

let resolved = false;
const startedAt = Date.now();
while (Date.now() - startedAt < METADATA_BUDGET_MS) {
  await wait(250);
  const now = engine.getTorrents()[0];
  if ((now?.size ?? "-") !== "-" && now?.size !== "0 B") { resolved = true; break; }
}
const waited = ((Date.now() - startedAt) / 1000).toFixed(1);
ck(`RESUME fetches the metadata a paused torrent could never get (${waited}s)`, resolved);

const after = engine.getTorrents()[0];
ck("the size is now known (" + after?.size + ")",
  after?.size !== "-" && after?.size !== "0 B");
ck("the file list is available", engine.getFiles(after.id).length === 1);
ck("it is no longer paused (" + after?.status + ")", after?.status !== "Paused");

// And the metadata must now be cached, so the NEXT launch needs none of this.
const cached = path.join(stateDir, "torrents", seeded.infoHash + ".torrent");
let cachedOk = false;
for (let attempt = 0; attempt < 20; attempt++) {
  await wait(250);
  if (fs.existsSync(cached) && fs.readFileSync(cached).includes("4:info")) {
    cachedOk = true;
    break;
  }
}
ck("the real metadata is cached for next time", cachedOk);

engine.destroy();
await new Promise(r => seeder.destroy(() => r(null)));
await new Promise(r => tracker.close(() => r(null)));
await wait(300);
done();
