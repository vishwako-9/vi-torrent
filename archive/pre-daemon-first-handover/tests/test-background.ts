import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
// The background downloader: does a ticked torrent survive the TUI exiting,
// and can the next launch see and control it?
//
// Spawns the real detached daemon against an isolated temp state dir.
import fs from "fs";
import os from "os";
import path from "path";
import { Engine } from "../src/engine.js";
import { DaemonClient } from "../src/daemon-client.js";

const UBUNTU = await fixtureTorrent();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Poll until predicate holds or we give up. */
async function until(what: string, predicate: () => boolean, ms = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return true;
    await wait(250);
  }
  console.log("  (timed out waiting for: " + what + ")");
  return false;
}

const m = async () => {
  const { ck, done } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vitorrent-bg-"));
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  const daemon = new DaemonClient(stateDir);

  // --- session 1: add a torrent and tick it for background ---
  const first = new Engine({ stateDir, downloadDir });
  await addTorrentNow(first, UBUNTU);
  await wait(2500);

  const item = first.getTorrents()[0];
  ck("torrent added", !!item);
  ck("it starts unticked", item?.background === false);

  first.toggleBackground(item.id);
  ck("engine reports pending background work", first.hasBackgroundTorrents());
  // Ticking hands the torrent straight to the daemon, so it leaves this
  // client and comes back as a remote row once the daemon has it.
  const tookOver = await until("daemon to take it over",
    () => first.getTorrents().some(t => t.remote && t.background), 25000);
  ck("ticking marks it for background and hands it over", tookOver);

  const entries = JSON.parse(fs.readFileSync(path.join(stateDir, "session.json"), "utf8"));
  ck("the tick is persisted", entries[0]?.background === true);

  // --- "close vitorrent" ---
  const handed = first.handoffToBackground();
  ck("handoff reported", handed);
  first.destroy();
  await wait(1000);

  const alive = await until("daemon to come up", () => daemon.isRunning());
  ck("a detached background downloader is running", alive);
  const pid = daemon.pid();
  ck("its pid is discoverable", typeof pid === "number" && pid! > 0);

  const gotStatus = await until("status file", () => daemon.torrents().length === 1);
  ck("it publishes live status for the torrent", gotStatus);
  ck("the torrent it reports is the right one",
    daemon.torrents()[0]?.name?.includes("sample") === true);

  // --- session 2: reopen the TUI ---
  const second = new Engine({ stateDir, downloadDir });
  const restored = second.restore();
  await wait(1500);

  ck("the TUI does NOT re-add a daemon-owned torrent", restored === 0);
  const listed = second.getTorrents();
  ck("but it still appears in the list", listed.length === 1);
  ck("shown as background-owned", listed[0]?.remote === true && listed[0]?.background === true);
  ck("with a Background status", listed[0]?.status === "Background" || listed[0]?.status === "Paused");
  ck("the app can report the background pid", second.backgroundPid() === pid);

  // --- full control over a background torrent ---
  second.pause(listed[0].id);
  const paused = await until("remote pause", () => daemon.torrents()[0]?.paused === true);
  ck("pausing a background torrent works", paused);

  second.resume(listed[0].id);
  const resumed = await until("remote resume", () => daemon.torrents()[0]?.paused === false);
  ck("resuming a background torrent works", resumed);

  // --- unticking hands it back to the TUI ---
  second.toggleBackground(listed[0].id);
  const reclaimed = await until("reclaim", () =>
    second.getTorrents().some(t => !t.remote && t.infoHash === item.infoHash));
  ck("unticking pulls it back into the TUI", reclaimed);
  const back = second.getTorrents().find(t => t.infoHash === item.infoHash);
  // It was RUNNING in the background (resumed just above), so it must come
  // back running. This assertion used to read "comes back paused, not
  // silently downloading" - that was wrong, and was reported from real use:
  // ticking BG keeps a torrent downloading, so unticking that stops it makes
  // the button a hidden pause. The handover now preserves state in both
  // directions; a torrent paused in the background still comes back paused,
  // which tests/test-bg-toggle-race.ts checks explicitly.
  //
  // "Never silently resume" still holds where it belongs: restore() on
  // launch, where the user is not watching.
  ck("it comes back RUNNING, because that is how it was handed over (got "
      + back?.status + ")",
    back?.status !== "Paused");
  ck("and is no longer ticked", back?.background === false);

  // Handing back the last torrent must not leave an idle invisible process.
  const daemonGone = await until("daemon to exit", () => !daemon.isRunning());
  ck("the background process exits once it owns nothing", daemonGone);

  second.destroy();
  await wait(800);

  // Safety net: never leave a stray daemon behind after the suite.
  if (daemon.isRunning()) { await daemon.shutdown(); await wait(1000); }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
