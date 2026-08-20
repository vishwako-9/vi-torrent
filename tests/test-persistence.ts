import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
// Session persistence: close the app, reopen it, get your torrents back -
// paused, with their existing data recognised.
//
// Uses its own Engine instances with explicitly injected directories rather
// than the singleton, so nothing here can reach the real session index.
import fs from "fs";
import os from "os";
import path from "path";
import { Engine } from "../src/engine.js";

const UBUNTU = await fixtureTorrent();

const m = async () => {
  const { ck, done } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-persist-"));
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  const mk = () => new Engine({ stateDir, downloadDir });
  const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

  // --- session 1: add a torrent, then "close the app" ---
  const first = mk();
  await addTorrentNow(first, UBUNTU);
  await settle();
  ck("session 1 has the torrent", first.getTorrents().length === 1);

  const indexPath = path.join(stateDir, "session.json");
  ck("session index written", fs.existsSync(indexPath));

  const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  ck("index has one entry", Array.isArray(entries) && entries.length === 1);
  ck("index records the save path", entries[0]?.savePath === downloadDir);
  ck("the .torrent metadata is cached alongside it",
    fs.existsSync(path.join(stateDir, "torrents", entries[0].infoHash + ".torrent")));

  first.destroy();
  await settle(800);

  // --- session 2: reopen ---
  const second = mk();
  const restored = second.restore();
  await settle();

  ck("restore() reports 1 torrent", restored === 1);
  ck("session 2 sees the torrent again", second.getTorrents().length === 1);
  ck("it comes back PAUSED, not downloading",
    second.getTorrents()[0]?.status === "Paused");
  ck("it kept its name (metadata came from the cached .torrent, not the network)",
    (second.getTorrents()[0]?.name ?? "").includes("sample"));

  // Restoring twice must not duplicate.
  const again = second.restore();
  await settle(500);
  ck("restoring again does not duplicate", again === 0 && second.getTorrents().length === 1);

  // Resume must actually work on a restored torrent.
  second.resume(second.getTorrents()[0].id);
  await settle(500);
  ck("a restored torrent can be resumed", second.getTorrents()[0]?.status !== "Paused");

  // --- removing must not resurrect on the next launch ---
  second.remove(second.getTorrents()[0].id);
  await settle(800);
  const afterRemove = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  ck("removed torrent is dropped from the index", afterRemove.length === 0);
  second.destroy();
  await settle(800);

  const third = mk();
  const restoredAfterRemove = third.restore();
  await settle(800);
  ck("a removed torrent does not come back", restoredAfterRemove === 0 && third.getTorrents().length === 0);
  third.destroy();

  // --- a corrupt index must not stop the app starting ---
  fs.writeFileSync(indexPath, "{ this is not json");
  const fourth = mk();
  let threw = false;
  try { fourth.restore(); } catch { threw = true; }
  ck("a corrupt session index is survivable", !threw);
  fourth.destroy();

  await settle(500);
  fs.rmSync(root, { recursive: true, force: true });
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
