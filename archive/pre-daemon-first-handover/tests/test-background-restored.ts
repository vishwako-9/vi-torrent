import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
// Mirrors the exact user flow that failed:
//   1. add a torrent, close        (no BG tick)
//   2. reopen -> it comes back PAUSED; tick BG; close
//   3. reopen -> the item must still be there, owned by the daemon, RUNNING
//
// The existing test-background.ts ticks a freshly ADDED (running) torrent.
// This one ticks a RESTORED (paused) torrent, which is what actually broke.
import fs from "fs";
import os from "os";
import path from "path";
import { Engine } from "../src/engine.js";
import { DaemonClient } from "../src/daemon-client.js";

const UBUNTU = await fixtureTorrent();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function until(what: string, p: () => boolean, ms = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (p()) return true; await wait(250); }
  console.log("  (timed out: " + what + ")");
  return false;
}

const m = async () => {
  const { ck, done } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vitorrent-bgr-"));
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  const daemon = new DaemonClient(stateDir);
  const mk = () => new Engine({ stateDir, downloadDir });

  // --- session 1 ---
  const s1 = mk();
  await addTorrentNow(s1, UBUNTU);
  await wait(2500);
  ck("session 1: torrent added", s1.getTorrents().length === 1);
  ck("session 1: no handoff, nothing ticked", s1.handoffToBackground() === false);
  s1.destroy();
  await wait(1200);

  // --- session 2: it comes back paused, then the user ticks BG ---
  const s2 = mk();
  s2.restore();
  await wait(2500);
  const restored = s2.getTorrents()[0];
  ck("session 2: restored", !!restored);
  ck("session 2: restored PAUSED", restored?.status === "Paused");

  // Watch the row CONTINUOUSLY across the handover. The earlier version of
  // this test polled until the row reappeared, which hid the fact that it
  // vanished for a second or two in between - reported as "clicked BG and the
  // line disappeared".
  // The restored row is an ordinary one - keep its shape to compare the
  // handover placeholder against below.
  const normalRowKeys = Object.keys(restored).sort().join(",");

  let vanished = false;
  let sawStarting = false;
  let startingRow: any = null;
  const watcher = setInterval(() => {
    const rows = s2.getTorrents();
    if (rows.length === 0) vanished = true;
    if (rows[0]?.status === "Starting...") {
      sawStarting = true;
      startingRow ??= rows[0];
    }
  }, 60);

  s2.toggleBackground(restored.id);
  ck("the row does not disappear the instant BG is clicked", s2.getTorrents().length === 1);

  const idx = JSON.parse(fs.readFileSync(path.join(stateDir, "session.json"), "utf8"));
  ck("session 2: tick persisted", idx[0]?.background === true);

  // Ticking must hand it over and START it - not leave it sitting paused
  // until the app is closed, which read as "the checkbox does nothing".
  const up = await until("daemon to start on tick", () => daemon.isRunning(), 25000);
  ck("ticking BG starts the background downloader immediately", up);

  const hasTorrent = await until("daemon torrent", () => daemon.torrents().length === 1);
  ck("daemon picked the torrent up", hasTorrent);

  const running = await until("unpaused", () => daemon.torrents()[0]?.paused === false, 15000);
  ck("it RUNS in the background, not paused", running);
  console.log("  daemon reports paused=" + daemon.torrents()[0]?.paused);

  clearInterval(watcher);
  ck("the row was NEVER absent at any point during the handover", !vanished);
  ck("it showed a 'Starting...' placeholder while handing over", sawStarting);

  // The handover row must carry EVERY field an ordinary row does. It used to
  // be a hand-written object literal, so a new TorrentItem field would reach
  // every other row and silently miss this one - a blank column, no error.
  // Comparing key sets is what actually catches that; asserting individual
  // values would keep passing while a field went missing.
  ck("the handover row has the same fields as an ordinary row"
      + (startingRow ? "" : " (never captured one)"),
    !!startingRow && Object.keys(startingRow).sort().join(",") === normalRowKeys);
  ck("the handover row still reads as ticked for background",
    startingRow?.background === true);
  ck("and reports progress as unknown rather than zero",
    startingRow?.progressRatio === -1 && startingRow?.progress === "-");

  const afterTick = s2.getTorrents();
  ck("session 2: still exactly one row after handover", afterTick.length === 1);
  ck("session 2: the row is now background-owned", afterTick[0]?.remote === true);
  ck("session 2: and no longer shows Paused", afterTick[0]?.status !== "Paused");

  ck("session 2: close confirms background work", s2.handoffToBackground() === true);
  s2.destroy();
  await wait(1500);

  // --- session 3: reopen; the item must still be attached ---
  const s3 = mk();
  const restoredCount = s3.restore();
  await wait(2000);
  const listed = s3.getTorrents();

  ck("session 3: the item is still there", listed.length === 1);
  ck("session 3: not double-added locally", restoredCount === 0);
  ck("session 3: shown as background-owned", listed[0]?.remote === true);
  ck("session 3: still ticked", listed[0]?.background === true);
  ck("session 3: not shown as Paused", listed[0]?.status !== "Paused");
  console.log("  session 3 sees: status=" + listed[0]?.status + " bg=" + listed[0]?.background);

  // --- the index must survive closing while NO daemon is running ---
  await daemon.shutdown();
  await until("daemon to stop", () => !daemon.isRunning(), 10000);
  s3.destroy();
  await wait(1000);

  const surviving = JSON.parse(fs.readFileSync(path.join(stateDir, "session.json"), "utf8"));
  ck("closing with no daemon running does NOT wipe the session index",
    surviving.length === 1);

  ck("session 4: it is still ticked, so the next launch will restart it",
    surviving[0]?.background === true);
  if (daemon.isRunning()) { await daemon.shutdown(); await wait(1200); }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
