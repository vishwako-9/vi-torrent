import { addTorrentNow, buildTorrent, checks, testRoot } from "./_isolate.js";
// Toggling BG on/off faster than the handover completes must not lose the row.
import { Engine } from "../src/engine.js";
import fs from "fs";
import path from "path";

const { ck, done } = checks();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const source = await buildTorrent(
  path.join(testRoot, "race"), "race.bin", { "race.bin": Buffer.alloc(256 * 1024, 5) });

const engine = new Engine();
const errors: string[] = [];
engine.onError(message => errors.push(message));

await addTorrentNow(engine, source);
await wait(1500);
ck("one torrent to work with", engine.getTorrents().length === 1);
const id = engine.getTorrents()[0].id;

// The handover is deliberately deferred (the local torrent is destroyed
// first, and the daemon is started a moment later). Toggling faster than
// that delay is the whole point: the user clicks BG on and immediately off.
for (let i = 0; i < 3; i++) {
  engine.toggleBackground(id);   // on
  await wait(60);
  engine.toggleBackground(id);   // off
  await wait(60);
}

// Let every deferred handover fire, then look at the wreckage.
await wait(2500);

const rows = engine.getTorrents();
ck("the row survives rapid BG on/off (found " + rows.length + ")", rows.length === 1);
ck("it is not left flagged for background", rows[0]?.background === false);
ck("it is owned by this process again, not stranded as remote",
  rows[0]?.remote === false);
ck("no 'could not reach the background downloader' (" + errors.join("; ") + ")",
  !errors.some(e => /could not reach/i.test(e)));

// A cancelled handover must not leave a daemon running for a torrent nobody
// ticked - it would keep downloading behind the user's back.
ck("no background downloader was left running", engine.backgroundRunning() === false);

// And the session index must agree with what the screen shows.
const indexPath = path.join(process.env.VITORRENT_STATE_DIR!, "session.json");
const index = fs.existsSync(indexPath)
  ? JSON.parse(fs.readFileSync(indexPath, "utf8")) : [];
ck("session index still holds the torrent", index.length === 1);
ck("and does not have it flagged for background", index[0]?.background === false);

// --- the same race driven from the OTHER button ---
//
// Reported as happening whichever button you click fast. "Stop background"
// goes through the same toggleBackground(), so it hit the identical window,
// and mixing the two is the worst case: each click lands while the previous
// handover is still in flight.
// Watch CONTINUOUSLY, not just at the end. "The line disappeared" is about
// what the user SEES, and the table repaints every second - a row that is
// missing for a moment and comes back is still the reported bug. Checking
// only the final state would pass on a gap the user would have watched
// happen.
let everEmpty = false;
const watcher = setInterval(() => {
  if (engine.getTorrents().length === 0) everEmpty = true;
}, 25);

const before = engine.getTorrents()[0].id;
for (let i = 0; i < 4; i++) {
  engine.toggleBackground(before);   // tick
  await wait(40);
  engine.stopBackground();           // untick, via the other button
  await wait(40);
}
await wait(2500);
clearInterval(watcher);
ck("the row was NEVER absent, not even for a moment", !everEmpty);

const mixed = engine.getTorrents();
ck("the row survives hammering BOTH buttons (found " + mixed.length + ")",
  mixed.length === 1);
ck("still owned locally, not stranded", mixed[0]?.remote === false);
ck("still unflagged", mixed[0]?.background === false);
ck("no 'could not reach' from either button (" + errors.join("; ") + ")",
  !errors.some(e => /could not reach/i.test(e)));
ck("no daemon left behind", engine.backgroundRunning() === false);

// --- a handover must not silently stop a download ---
//
// Reported: tick BG and untick it in the same session, and the torrent comes
// back PAUSED. Ticking it again starts it downloading. That round trip is not
// symmetric - ticking BG keeps a torrent going, so unticking has to as well,
// or the button quietly stops downloads.
//
// This uses the cancel path (no daemon involved), which is the same
// readdLocally() the daemon reclaim uses.
{
  const t = engine.getTorrents()[0];
  engine.resume(t.id);                       // make sure it is running
  await wait(300);
  ck("running before the handover",
    engine.getTorrents()[0]?.status !== "Paused");

  engine.toggleBackground(t.id);             // tick
  await wait(80);
  engine.toggleBackground(t.id);             // untick inside the window
  await wait(1500);

  ck("a running torrent comes back running, not paused (got "
      + engine.getTorrents()[0]?.status + ")",
    engine.getTorrents()[0]?.status !== "Paused");
}

// The mirror image: a PAUSED torrent must not be silently started.
{
  const t = engine.getTorrents()[0];
  engine.pause(t.id);
  await wait(300);
  ck("paused before the handover", engine.getTorrents()[0]?.status === "Paused");

  engine.toggleBackground(t.id);
  await wait(80);
  engine.toggleBackground(t.id);
  await wait(1500);

  ck("a paused torrent comes back paused (got "
      + engine.getTorrents()[0]?.status + ")",
    engine.getTorrents()[0]?.status === "Paused");
}

engine.destroy();
await wait(400);
done();
