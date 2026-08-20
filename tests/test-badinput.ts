import { checks } from "./_isolate.js";
import { Engine } from "../src/engine.js";
const e = new Engine();
let asyncErr = "";
const { ck, done } = checks();
e.onError(m => { asyncErr = m; });
try { e.previewMagnet("not-a-magnet"); ck("bad magnet rejected", false); }
catch (err: any) { ck("bad magnet: " + err.message.slice(0,40), err.message.includes("Not a magnet")); }
// a bencoded dict that is NOT a valid torrent -> passes the 'd' check,
// must be caught asynchronously by the unhandledRejection handler
require("fs").writeFileSync("tests/fake.torrent", "d4:spam4:eggse");
try { e.previewFile("tests/fake.torrent"); } catch (err: any) { asyncErr = err.message; }
setTimeout(() => {
  ck("async invalid torrent surfaced: " + asyncErr.slice(0,50), asyncErr.length > 0 && !asyncErr.includes("Invalid torrent identifier"));
  require("fs").unlinkSync("tests/fake.torrent");
  e.destroy();
  done();
}, 1200);
