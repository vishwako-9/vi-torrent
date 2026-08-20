import { addTorrentNow, checks, settle } from "./_isolate.js";
import { Engine } from "../src/engine.js";
const e = new Engine();
const mk = (n: string) => "magnet:?xt=urn:btih:" + n.repeat(40).slice(0, 40) + "&dn=" + n;
await addTorrentNow(e, mk("a")); await addTorrentNow(e, mk("b")); await addTorrentNow(e, mk("c"));
setTimeout(() => {
  const { ck, done } = checks();
  const before = e.getTorrents().map(t => t.id);
  console.log("ids before:", before.join(","));
  ck("three distinct ids", new Set(before).size === 3);

  e.remove(before[0]);
  const after = e.getTorrents().map(t => t.id);
  console.log("ids after removing id " + before[0] + ":", after.join(","));
  ck("survivors keep their original ids", after.every(id => before.includes(id)));
  ck("removed id is gone", !after.includes(before[0]));
  ck("no renumbering (still 1,2 not 0,1)", after[0] === before[1] && after[1] === before[2]);

  try { e.remove(before[0]); ck("removing a dead id errors", false); }
  catch { ck("removing a dead id errors", true); }

  // Row ORDER, not just id allocation. getTorrents() concatenates three
  // ownership buckets - local, downloader-owned, in transit - and a torrent
  // moves between them, so without a sort a row's position depended on who
  // owned it. Nine torrents being picked up one at a time made every row jump
  // each second, which reads as the status column flashing rather than as the
  // rows moving. Reported from real use 2026-08-02.
  const ids = e.getTorrents().map(t => t.id);
  ck("rows come back sorted by id",
    ids.join() === [...ids].sort((a, b) => a - b).join());

  e.destroy();
  done();
}, 400);
