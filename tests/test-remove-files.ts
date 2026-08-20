import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
// "Remove + Files" must leave nothing behind - including the torrent's own
// folder. WebTorrent's destroyStore deletes the FILES but not the directory
// that contained them, so a multi-file torrent left an empty folder.
//
// Builds its own multi-file torrent offline; no network needed.
import fs from "fs";
import os from "os";
import path from "path";
import WebTorrent from "webtorrent";
import { Engine } from "../src/engine.js";
import { removeTorrentFolder } from "../src/remove-folder.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const m = async () => {
  const { ck, done } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-rm-"));
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });

  // --- a multi-file torrent, with a nested folder for good measure ---
  const source = path.join(root, "src", "MyRelease");
  fs.mkdirSync(path.join(source, "extras"), { recursive: true });
  fs.writeFileSync(path.join(source, "movie.bin"), Buffer.alloc(48 * 1024, 1));
  fs.writeFileSync(path.join(source, "readme.txt"), "hello");
  fs.writeFileSync(path.join(source, "extras", "bonus.bin"), Buffer.alloc(16 * 1024, 2));

  const builder = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
  builder.on("error", () => {});
  const built: any = await new Promise(res =>
    builder.seed(source, { announce: [] } as any, (t: any) => res(t)));
  const torrentPath = path.join(root, "release.torrent");
  fs.writeFileSync(torrentPath, built.torrentFile);
  const torrentName: string = built.name;
  await new Promise(r => builder.destroy(() => r(null)));

  // Put a complete copy where the engine will look, so it verifies to 100%.
  fs.cpSync(source, path.join(downloadDir, torrentName), { recursive: true });
  const target = path.join(downloadDir, torrentName);
  ck("the torrent folder exists to begin with", fs.existsSync(target));

  const engine = new Engine({ stateDir, downloadDir });
  await addTorrentNow(engine, torrentPath);
  await wait(3000);
  ck("torrent added", engine.getTorrents().length === 1);

  // --- Remove + Files ---
  engine.remove(engine.getTorrents()[0].id, true);
  await wait(3000);

  ck("the torrent is gone from the list", engine.getTorrents().length === 0);
  ck("the files are deleted",
    !fs.existsSync(path.join(target, "movie.bin")) &&
    !fs.existsSync(path.join(target, "extras", "bonus.bin")));
  ck("the torrent's FOLDER is gone too", !fs.existsSync(target));
  ck("the download directory itself survives", fs.existsSync(downloadDir));

  // --- the cleanup itself: it deletes things, so test its guards directly ---
  const sandbox = path.join(root, "guards");
  fs.mkdirSync(sandbox, { recursive: true });

  // A folder holding a file the user put there must survive.
  const keepDir = path.join(sandbox, "keep-me");
  fs.mkdirSync(path.join(keepDir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(keepDir, "my-notes.txt"), "do not delete me");
  ck("a folder containing a file is NOT removed",
    removeTorrentFolder(sandbox, "keep-me") === false && fs.existsSync(keepDir));

  // Empty nested folders are what a destroyed multi-file torrent leaves.
  const emptyTree = path.join(sandbox, "empty-tree");
  fs.mkdirSync(path.join(emptyTree, "a", "b"), { recursive: true });
  ck("a tree of empty folders IS removed",
    removeTorrentFolder(sandbox, "empty-tree") === true && !fs.existsSync(emptyTree));

  // The save directory itself must never be deleted.
  ck("it refuses to delete the save directory", removeTorrentFolder(sandbox, ".") === false);
  ck("the save directory is still there", fs.existsSync(sandbox));

  // Torrent names come from untrusted metadata.
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside, { recursive: true });
  ck("it refuses to escape the save directory",
    removeTorrentFolder(sandbox, path.join("..", "outside")) === false);
  ck("the folder outside is untouched", fs.existsSync(outside));

  // A single-file torrent's "name" is a file, not a folder.
  fs.writeFileSync(path.join(sandbox, "single.bin"), "x");
  ck("it does nothing when the name is a file",
    removeTorrentFolder(sandbox, "single.bin") === false &&
    fs.existsSync(path.join(sandbox, "single.bin")));

  ck("a missing folder is a no-op", removeTorrentFolder(sandbox, "never-existed") === false);

  engine.destroy();
  await wait(600);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
