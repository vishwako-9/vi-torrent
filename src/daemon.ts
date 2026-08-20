/**
 * The daemon.
 *
 * Stage 2 of the daemon-first rewrite (docs/daemon_first_acceptance.md): this
 * now owns a full torrent-core.js Engine for every torrent in the session,
 * not just ones flagged for background download - that concept is gone (see
 * commit "Delete the handover"). It is not yet auto-started or auto-stopped
 * by the TUI; that is stage 3, when engine.ts's local Engine is replaced by
 * a proxy that talks to this process instead of running its own.
 *
 * ponytail: idle-exit (N6/N7 in the acceptance doc - shut down once nothing
 * is held, cancel that if something is added back within the window) is
 * deliberately NOT built here. It only makes sense once something restarts
 * the daemon on demand, which is stage 3's job. Exiting today would just
 * mean nothing runs.
 *
 * Two channels, unchanged from stage 1:
 *   - STATUS is a file (daemon-status.json) rewritten every second. A client
 *     reads it synchronously on its own refresh tick, so live progress needs
 *     no async plumbing in the render path.
 *   - CONTROL is a tiny HTTP server bound to 127.0.0.1 with a random token.
 *     Commands are user-initiated and can afford to be async.
 *
 * Run as:  bun run src/daemon.ts --state <stateDir>
 */
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Engine, type TorrentItem, type PreviewInfo } from "./torrent-core.js";
import type { AppSettings } from "./settings.js";

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
if (stateIndex === -1 || !args[stateIndex + 1]) {
  console.error("usage: daemon.ts --state <stateDir>");
  process.exit(1);
}

const stateDir = args[stateIndex + 1];
// Must exist before anything below writes into it. Before this rewrite the
// TUI's own local engine always created this directory first (saveSession()
// does an incidental mkdirSync), so the daemon - spawned strictly after -
// never had to. Now the daemon can be the very first thing that touches
// stateDir (a genuinely first-ever run), and fs.writeFileSync does not
// create missing parent directories: daemon.json's write threw, killing the
// freshly-spawned daemon silently (stdio is "ignore" for a detached spawn),
// so `ready()` polled for a status file that was never coming. Found by
// actually running the daemon-backed proxy end to end, not from the diff.
fs.mkdirSync(stateDir, { recursive: true });
const daemonPath = path.join(stateDir, "daemon.json");
const statusPath = path.join(stateDir, "daemon-status.json");
const logPath = path.join(stateDir, "daemon.log");

const log = (msg: string): void => {
  try {
    fs.appendFileSync(logPath, new Date().toISOString() + " " + msg + "\n");
  } catch {
    // Logging must never take the daemon down.
  }
};

/** Is a process with this pid actually alive? */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse to start a second daemon for the same state dir - two clients
 * writing the same files would corrupt downloads.
 *
 * The check used to be "does daemon.json already name a live pid" done
 * ONCE, here, up front - but daemon.json itself was not written until much
 * later (server.listen()'s callback, well after Engine construction and a
 * full session restore, real time on a session with several torrents). Two
 * windows launched close enough together (e.g. double-clicking two .torrent
 * files back to back) could both pass that early check before either had
 * written anything, both spawn a real daemon, and end up with one orphaned
 * daemon nothing ever points to - alive, doing nothing, until someone kills
 * it by hand. Verified as a real gap by reading this exact sequence, not a
 * hypothetical.
 *
 * Fixed with an OS-level atomic claim instead of check-then-later-write:
 * `flag: "wx"` fails with EEXIST if the file already exists, so only ONE
 * process can ever win the create - there is no gap between "check" and
 * "claim" for a second process to land in, because they are the same
 * filesystem operation. The claim is pid-only at this point (port/token
 * are not known until the server actually binds) - daemon-client.ts's
 * handle() already requires port+token+pid together, so another window
 * reading this file mid-claim correctly sees "not running yet", not a
 * broken state.
 */
function claimDaemonJson(): void {
  try {
    fs.writeFileSync(daemonPath, JSON.stringify({ pid: process.pid }), { flag: "wx" });
    return; // won the claim
  } catch (e: any) {
    if (e?.code !== "EEXIST") throw e; // a real filesystem problem - not ours to swallow
  }

  // Lost the atomic create - something is already there. Distinguish a
  // genuinely live daemon (back off) from a stale leftover a crashed
  // daemon never cleaned up (take over - a crash must never lock everyone
  // out permanently).
  let existing: { pid?: number } | null = null;
  try {
    existing = JSON.parse(fs.readFileSync(daemonPath, "utf8"));
  } catch {
    // Corrupt daemon.json - treated as stale, fall through to take over.
  }
  if (existing?.pid && existing.pid !== process.pid && pidAlive(existing.pid)) {
    log("another daemon is already running (pid " + existing.pid + "), exiting");
    process.exit(0);
  }

  // Stale: the pid it names is dead (or the file was corrupt/unreadable).
  // A plain overwrite is safe here - the only process that could contest it
  // is dead, so there is no live opponent left to race against.
  fs.writeFileSync(daemonPath, JSON.stringify({ pid: process.pid }));
}
claimDaemonJson();

const core = new Engine({ stateDir });
let lastError: { message: string; at: number } | null = null;
core.onError(message => { lastError = { message, at: Date.now() }; });

const restoredCount = core.restore();
log("restored " + restoredCount + " torrent(s) from the session index");

/**
 * Watched independently of any TUI, because that is the entire point: the
 * user arms this, then may close every window, and the daemon still has to
 * notice on its own and stop itself once core.allFinished() is true. Checked
 * on the same 1s ticker that already writes the status file - see the loop
 * at the bottom of this file.
 */
let shutdownWhenDoneArmed = false;

/** Resolve the wire identifier (infoHash) to the id core's own methods use. */
function idFor(infoHash: string): number {
  const t = core.getTorrents().find(x => x.infoHash === infoHash);
  if (!t) throw new Error("No torrent with infoHash " + infoHash);
  return t.id;
}

function snapshot() {
  return {
    pid: process.pid,
    updatedAt: Date.now(),
    torrents: core.getTorrents() as TorrentItem[],
    preview: core.getPreview() as PreviewInfo | null,
    restored: [...core.getRestoredHashes()],
    settings: core.getSettings(),
    error: lastError,
    shutdownWhenDoneArmed,
  };
}

function writeStatus(): void {
  try {
    fs.writeFileSync(statusPath, JSON.stringify(snapshot()));
  } catch {
    // Status is advisory; a failed write just means one stale tick.
  }
}

const token = crypto.randomBytes(24).toString("hex");

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  clearInterval(ticker);
  for (const p of [daemonPath, statusPath]) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
  try { server.close(); } catch { /* not listening */ }
  core.destroy();
  setTimeout(() => process.exit(code), 200);
}

const server = http.createServer((req, res) => {
  const reply = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.headers["x-vi-torrent-token"] !== token) return reply(403, { error: "forbidden" });

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/status") return reply(200, snapshot());
  if (req.method === "GET" && url.pathname === "/files") {
    try {
      return reply(200, { files: core.getFiles(idFor(url.searchParams.get("infoHash") ?? "")) });
    } catch (e) {
      return reply(404, { error: String(e) });
    }
  }
  if (req.method === "GET" && url.pathname === "/peers") {
    try {
      return reply(200, { peers: core.getPeers(idFor(url.searchParams.get("infoHash") ?? "")) });
    } catch (e) {
      return reply(404, { error: String(e) });
    }
  }

  let raw = "";
  req.on("data", chunk => { raw += chunk; });
  req.on("end", () => {
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: "bad json" }); }

    try {
      switch (url.pathname) {
        case "/preview/magnet":
          core.previewMagnet(body.uri);
          break;
        case "/preview/file":
          core.previewFile(body.path);
          break;
        case "/preview/confirm":
          core.confirmPreview(body.skipped ?? []);
          break;
        case "/preview/cancel":
          core.cancelPreview();
          break;
        case "/pause":
          core.pause(idFor(body.infoHash));
          break;
        case "/resume":
          core.resume(idFor(body.infoHash));
          break;
        case "/remove":
          core.remove(idFor(body.infoHash), !!body.deleteFiles);
          break;
        case "/files/toggle":
          core.toggleFile(idFor(body.infoHash), body.fileIndex);
          break;
        case "/files/set-all": {
          const changed = core.setAllFiles(idFor(body.infoHash), !!body.wanted, body.keep ?? 0);
          writeStatus();
          return reply(200, { ok: true, changed });
        }
        case "/settings": {
          const restartRequired = core.applySettings(body.settings as AppSettings);
          writeStatus();
          return reply(200, { ok: true, restartRequired });
        }
        case "/shutdown-when-done":
          // Idempotent either way, and takes effect from the NEXT ticker
          // pass rather than checking immediately here - one code path
          // (the ticker) is the only place that decides to fire, so arming
          // and the actual check can never disagree about the rule.
          shutdownWhenDoneArmed = !!body.armed;
          log("shutdown-when-done " + (shutdownWhenDoneArmed ? "armed" : "cancelled"));
          break;
        case "/shutdown":
          reply(200, { ok: true });
          return shutdown(0);
        default:
          return reply(404, { error: "unknown endpoint" });
      }
    } catch (e) {
      return reply(500, { error: String(e) });
    }

    writeStatus();
    reply(200, { ok: true });
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  fs.writeFileSync(daemonPath, JSON.stringify({
    pid: process.pid,
    port,
    token,
    startedAt: Date.now(),
  }, null, 2));
  log("listening on 127.0.0.1:" + port);
  writeStatus();
});

const ticker = setInterval(() => {
  writeStatus();
  // Checked here, and only here - the one place that decides to actually
  // fire. Re-evaluated fresh every tick rather than against a frozen set of
  // ids from when it was armed, so a torrent added afterwards still has to
  // finish, and closing every TUI window in the meantime changes nothing.
  if (shutdownWhenDoneArmed && core.allFinished()) {
    log("shutdown-when-done: every torrent finished, shutting down");
    shutdown(0);
  }
}, 1000);

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => shutdown(0));
}
