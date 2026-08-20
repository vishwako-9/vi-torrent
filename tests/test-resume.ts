import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
// Regression: a torrent restored PAUSED must actually start downloading when
// the user clicks Resume.
//
// WebTorrent discards every peer it discovers while a torrent is paused
// (torrent.js "ignoring peer: torrent is paused"), and resume() only drains
// an already-empty peer queue - it does not re-announce. So a restored
// torrent could sit at 0 peers until the tracker's next announce interval,
// which is typically many minutes away. Clicking Resume appeared to do
// nothing.
//
// Runs fully offline against a real local tracker.
import WebTorrent from "webtorrent";
import { Server } from "bittorrent-tracker";
import fs from "fs";
import os from "os";
import path from "path";
import { Engine } from "../src/engine.js";

const SIZE = 2 * 1024 * 1024;
const NAME = "resumetest.bin";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return true;
    await wait(250);
  }
  return false;
}

const m = async () => {
  const { ck, done } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-resume-"));
  const seedDir = path.join(root, "seed");
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  [seedDir, stateDir, downloadDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  const data = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) data[i] = (i * 7 + (i >> 9)) & 0xff;
  fs.writeFileSync(path.join(seedDir, NAME), data);

  // --- a real tracker, on localhost ---
  const tracker: any = new Server({ udp: false, http: true, ws: false, stats: false });
  tracker.on("error", () => {});
  tracker.on("warning", () => {});
  const port: number = await new Promise(res => {
    tracker.listen(0, "127.0.0.1", () => res(tracker.http.address().port));
  });
  const announce = [`http://127.0.0.1:${port}/announce`];
  console.log("tracker on " + announce[0]);

  // Build the metadata, then shut this client down so NOTHING is seeding
  // yet. Session 1 must end with the download genuinely incomplete -
  // otherwise it restores at 100% and Resume passes trivially.
  const builder = new WebTorrent({ dht: false, lsd: false, ...platformOptions() } as any);
  builder.on("error", () => {});
  const built: any = await new Promise(res =>
    builder.seed(path.join(seedDir, NAME), { announce } as any, (t: any) => res(t)),
  );
  const torrentFile: Buffer = built.torrentFile;
  fs.writeFileSync(path.join(root, "fixture.torrent"), torrentFile);
  await new Promise(r => builder.destroy(() => r(null)));

  // --- session 1: add it with no seeder alive, then close ---
  const first = new Engine({ stateDir, downloadDir });
  await addTorrentNow(first, path.join(root, "fixture.torrent"));
  await wait(2500);
  ck("torrent added in session 1", first.getTorrents().length === 1);
  ck("session 1 downloaded nothing (no seeder yet)", first.getTorrents()[0]?.progress === "0.0%");
  first.destroy();
  await wait(1200);

  // --- now a seeder appears, exactly as a real swarm would ---
  // Added from the same torrentFile so the infoHash is identical; the
  // complete file is already in seedDir, so it verifies and seeds.
  const seeder = new WebTorrent({ dht: false, lsd: false, ...platformOptions() } as any);
  seeder.on("error", () => {});
  seeder.add(torrentFile, { path: seedDir } as any);
  await wait(3000);
  console.log("seeder up");

  // --- session 2: reopen; it comes back paused ---
  const second = new Engine({ stateDir, downloadDir });
  const restored = second.restore();
  await wait(3000);
  ck("restored on reopen", restored === 1);

  const item = second.getTorrents()[0];
  ck("comes back paused", item?.status === "Paused");
  ck("nothing downloaded yet", item?.progress === "0.0%");

  // Give it time to announce and discover the seeder WHILE PAUSED - those
  // peers are the ones WebTorrent throws away.
  await wait(4000);

  // --- the actual regression: click Resume ---
  second.resume(item.id);

  const started = await until(() => {
    const t = second.getTorrents()[0];
    return !!t && t.progress !== "0.0%";
  }, 25000);

  ck("clicking Resume actually starts the download", started);
  const finalItem = second.getTorrents()[0];
  console.log("  final: status=" + finalItem?.status + " progress=" + finalItem?.progress);

  second.destroy();
  await wait(500);
  await new Promise(r => seeder.destroy(() => r(null)));
  await new Promise(r => tracker.close(() => r(null)));
  await wait(300);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
