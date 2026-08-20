import { checks, settle, buildTorrent, addTorrentNow, testRoot } from "./_isolate.js";
/**
 * Hammering Pause/Resume on a whole selection.
 *
 * Reported concern: "select all, then pause resume pause resume - maybe the
 * code takes time to apply that, if I trigger a different action it may
 * crash, because the existing one is in action". The proposed fix was a 600ms
 * timer like the background handover uses.
 *
 * This suite exists to answer that with a measurement instead of an opinion,
 * because a 600ms delay on Pause is expensive if the race is not real: it
 * would make every press feel broken, and would only narrow the window rather
 * than close it if it were.
 *
 * For LOCAL torrents `engine.pause()`/`resume()` are synchronous - they call
 * straight through to `torrent.pause()`/`torrent.resume()` and return. There
 * is no in-flight operation for a second press to collide with. The handover
 * timer is a different case entirely: that one crosses a process boundary and
 * transfers ownership.
 */
import { Engine } from "../src/engine.js";
import path from "path";

const { ck, done } = checks();

const dir = path.join(testRoot, "rapid");
const torrents: string[] = [];
for (let i = 0; i < 4; i++) {
  torrents.push(await buildTorrent(dir, `r${i}.bin`, {
    [`r${i}.bin`]: Buffer.alloc(48 * 1024, i + 1),
  }));
}

const engine = new Engine({
  stateDir: process.env.VI_TORRENT_STATE_DIR,
  downloadDir: process.env.VI_TORRENT_DOWNLOAD_DIR,
});

const errors: string[] = [];
engine.onError(m => errors.push(m));

// addTorrentNow returns void - the ids come from the engine afterwards.
for (const t of torrents) await addTorrentNow(engine, t);
await settle(async () => {}, 400);
ck("four torrents added", engine.getTorrents().length === 4);

const ids = engine.getTorrents().map(t => t.id);
ck("every torrent has a usable id", ids.length === 4 && ids.every(Number.isFinite));

const statuses = () => engine.getTorrents().map(t => t.status);
const pausedCount = () => statuses().filter(s => s === "Paused").length;

// --- alternate as fast as the code can go, no awaiting between ---
// 20 full cycles over 4 torrents = 160 calls with nothing yielding in between.
let threw = 0;
for (let round = 0; round < 20; round++) {
  for (const id of ids) {
    try { engine.pause(id); } catch { threw++; }
  }
  for (const id of ids) {
    try { engine.resume(id); } catch { threw++; }
  }
}
ck("160 alternating calls threw nothing", threw === 0);
ck("no torrent was lost", engine.getTorrents().length === 4);
ck("all four ended running, matching the last call", pausedCount() === 0);

// --- and the other way round, ending paused ---
for (let round = 0; round < 20; round++) {
  for (const id of ids) {
    try { engine.resume(id); } catch { threw++; }
  }
  for (const id of ids) {
    try { engine.pause(id); } catch { threw++; }
  }
}
ck("reversing the order threw nothing either", threw === 0);
ck("all four ended paused, matching the last call", pausedCount() === 4);
ck("still four torrents", engine.getTorrents().length === 4);

// --- let the event loop catch up, then check nothing arrived late ---
// The failure the report describes would show up here: an operation still
// "in action" landing after the fact and undoing the final state.
await settle(async () => {}, 1200);
ck("the state holds after the event loop drains", pausedCount() === 4);
ck("no torrent went missing afterwards", engine.getTorrents().length === 4);

// --- pause must stop ALREADY-connected peers, not just block new ones ---
// Reported bug (2026-08-09): status showed Paused but the download kept
// climbing. Root cause, confirmed by reading the installed webtorrent
// library (node_modules/webtorrent/lib/torrent.js): torrent.pause() only
// sets a flag that blocks NEW connections (_drain/addPeer/_addIncomingPeer
// all gate on it) - peers already connected keep transferring completely
// unaffected. Fixed by also destroying torrent.wires on pause.
{
  const item = engine.getTorrents().find(t => t.id === ids[1])!;
  const live: any = (engine as any).client.torrents.find((t: any) => t.infoHash === item.infoHash);
  let destroyed = 0;
  const originalWires = live.wires ?? [];
  live.wires = [...originalWires, { destroy: () => { destroyed++; } }];
  engine.pause(ids[1]);
  ck("pausing destroys already-connected wires, not just blocks new ones", destroyed === 1);
  // wires is append-only in this library (only ever .push, never spliced -
  // confirmed reading torrent.js) - the fake stub above is not a real
  // EventEmitter, so leaving it in place crashed engine.destroy()'s later
  // teardown (rarity-map.js calls wire.removeListener() on every wire).
  live.wires = originalWires;
  engine.resume(ids[1]);
}

// --- a DIFFERENT action interleaved, which is what was actually described ---
for (const id of ids) {
  engine.pause(id);
  engine.resume(id);
  engine.pause(id);
  engine.getFiles(id);   // read while the state is churning
  engine.getTorrents();
  engine.resume(id);
}
await settle(async () => {}, 800);
ck("interleaving reads with rapid toggles is safe", engine.getTorrents().length === 4);
ck("...and leaves them running", pausedCount() === 0);

// --- errors surfaced to the UI during all of that ---
//
// Scoped to what rapid toggling could actually break, NOT a blanket
// "no errors at all". The blanket version was flaky in the full sweep -
// roughly one run in three - because the engine does real peer discovery
// during tests and unrelated network noise reached the same listener. A
// check that fails for reasons unconnected to what it is testing teaches
// people to ignore it.
//
// These are the messages a torrent lost or double-handled would produce.
const stateErrors = errors.filter(m =>
  /no torrent|not found|no such|invalid torrent id/i.test(m));
ck("no torrent went missing or was double-handled", stateErrors.length === 0);
if (stateErrors.length > 0) console.log("       reported: " + stateErrors.slice(0, 3).join(" | "));
// Anything else is printed but not failed, so it stays visible without
// making the suite unreliable.
const other = errors.filter(m => !stateErrors.includes(m));
if (other.length > 0) console.log("       (network noise, not failed: " + other.slice(0, 2).join(" | ") + ")");

// --- removal during rapid toggling must not resurrect anything ---
engine.pause(ids[0]);
engine.remove(ids[0]);
try { engine.resume(ids[0]); } catch { /* expected: it is gone */ }
await settle(async () => {}, 600);
ck("a removed torrent stays removed", engine.getTorrents().length === 3);
ck("...and resuming it does not bring it back",
  !engine.getTorrents().some(t => t.id === ids[0]));

engine.destroy();

/**
 * The path where the concern IS real: daemon-owned torrents.
 *
 * Local pause/resume is synchronous. A background torrent's commands are HTTP
 * requests fired without awaiting, so before serialisation two of them could
 * land out of order and leave the daemon in the opposite state to the last
 * button pressed. Driven through DaemonClient directly with a stub transport,
 * because reproducing an out-of-order arrival against a real socket is a race
 * by definition.
 */
const { DaemonClient } = await import("../src/daemon-client.js");

const arrivals: string[] = [];
const client: any = new DaemonClient(path.join(testRoot, "rapid-daemon"));
// Stand in for the HTTP round trip, with a deliberately UNFAIR delay: the
// first command takes longer than the second, which is exactly the case that
// used to reorder them.
let call = 0;
client.command = async (endpoint: string) => {
  const mine = call++;
  await new Promise(r => setTimeout(r, mine === 0 ? 60 : 5));
  arrivals.push(endpoint);
  return true;
};

// First prove the stub really does reorder when nothing serialises it -
// otherwise the check below passes whether the fix is there or not.
await Promise.all([client.command("/pause"), client.command("/resume")]);
ck("unserialised, the stub DOES arrive out of order",
  arrivals.join(",") === "/resume,/pause");

arrivals.length = 0;
call = 0;
const a = client.pause("HASH-A");
const b = client.resume("HASH-A");
await Promise.all([a, b]);
ck("a slow command still lands before the fast one behind it",
  arrivals.join(",") === "/pause,/resume");

// Different torrents must NOT wait for each other.
arrivals.length = 0;
call = 0;
await Promise.all([client.pause("HASH-B"), client.pause("HASH-C")]);
ck("two different torrents both got their command", arrivals.length === 2);

// A failed command must not strand everything queued behind it.
arrivals.length = 0;
client.command = async (endpoint: string) => {
  if (endpoint === "/pause") throw new Error("network gone");
  arrivals.push(endpoint);
  return true;
};
await client.pause("HASH-D").catch(() => {});
await client.resume("HASH-D");
ck("a failed command does not block the next one", arrivals.join(",") === "/resume");

done();
