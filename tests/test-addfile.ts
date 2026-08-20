import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
import { Engine } from "../src/engine.js";
import fs from "fs";
const e = new Engine();
  const { ck, done } = checks();
// junk file
fs.writeFileSync("tests/junk.torrent", "this is not a torrent");
try { e.previewFile("tests/junk.torrent"); ck("junk file rejected", false); }
catch (err: any) { ck("junk file rejected: " + err.message.slice(0,45), err.message.includes("bad bencode")); }
// html file
fs.writeFileSync("tests/page.torrent", "<!DOCTYPE html><html>404</html>");
try { e.previewFile("tests/page.torrent"); ck("html rejected", false); }
catch (err: any) { ck("html detected: " + err.message.slice(0,40), err.message.includes("HTML")); }
// real torrent - accepted, and confirmed so it actually lands in the list
try { await addTorrentNow(e, await fixtureTorrent()); ck("real torrent accepted", true); }
catch (err: any) { ck("real torrent accepted (" + err.message + ")", false); }
setTimeout(() => {
  ck("real torrent present", e.getTorrents().length === 1);
  fs.unlinkSync("tests/junk.torrent"); fs.unlinkSync("tests/page.torrent");
  e.destroy();
  done();
}, 700);
