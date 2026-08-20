import { buildTorrent, checks, testRoot } from "./_isolate.js";
/**
 * A cached .torrent must contain real metadata, or not exist.
 *
 * WebTorrent exposes `torrentFile` before metadata arrives: a ~165-byte
 * bencoded stub with no `info` dictionary, which parse-torrent rejects with
 * "Torrent is missing required field: info". The engine cached that stub and
 * then never overwrote it - the write was guarded by `!existsSync` - so the
 * session was poisoned permanently. Every launch restored an unparseable
 * torrent, which failed instantly, forever.
 *
 * Found on two real magnets that failed identically on every restart, with
 * 165-byte files sitting in ~/.vi-torrent/torrents.
 */
import fs from "fs";
import path from "path";
import { Engine } from "../src/engine.js";

const { ck, done } = checks();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const stateDir = process.env.VI_TORRENT_STATE_DIR!;
const cacheDir = path.join(stateDir, "torrents");
const indexPath = path.join(stateDir, "session.json");

const source = await buildTorrent(
  path.join(testRoot, "cache"), "cache.bin", { "cache.bin": Buffer.alloc(80 * 1024, 6) });
const realBytes = fs.readFileSync(source);
ck("a real .torrent contains an info dictionary", realBytes.includes("4:info"));

// --- a real add caches REAL metadata ---
const first = new Engine();
first.onError(() => {});
first.previewFile(source);
await wait(300);
first.confirmPreview();
await wait(1200);

const hash = first.getTorrents()[0]?.infoHash;
ck("the torrent was added", !!hash);
const cachedPath = path.join(cacheDir, hash + ".torrent");
ck("its metadata was cached", fs.existsSync(cachedPath));
ck("and the cache holds a REAL torrent, not a stub",
  fs.readFileSync(cachedPath).includes("4:info"));
first.destroy();
await wait(600);

// --- now poison it, exactly as the old code did ---
// A stub: valid bencode, no info dictionary. This is what WebTorrent hands
// out for a magnet whose metadata has not arrived.
const stub = Buffer.from("d8:announce30:http://127.0.0.1:1/announcee");
ck("the stub is bencode but has no info dictionary",
  stub[0] === 0x64 && !stub.includes("4:info"));
fs.writeFileSync(cachedPath, stub);
ck("the cache is now poisoned", !fs.readFileSync(cachedPath).includes("4:info"));

// --- restoring must survive it, not fail forever ---
const second = new Engine();
const errors: string[] = [];
second.onError(m => errors.push(m));
const restored = second.restore();
await wait(1500);

ck("restore did not throw", true);
ck("the poisoned cache entry was deleted rather than reused",
  !fs.existsSync(cachedPath));
ck("no unparseable-torrent error was raised (" + errors.join("; ") + ")",
  !errors.some(e => /missing required field|invalid torrent/i.test(e)));

// The entry has no magnetURI to fall back on in this fixture, so the row may
// legitimately be absent - what must NOT happen is a permanent failure or a
// crash. The session index must also survive.
const index = fs.existsSync(indexPath)
  ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : [];
ck("the session index survived the bad cache entry", Array.isArray(index));
ck("restore() returned a number, not a thrown error", typeof restored === "number");

second.destroy();
await wait(400);
done();
