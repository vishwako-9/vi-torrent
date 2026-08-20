import WebTorrent from "webtorrent";
import os from "os";
import path from "path";
import fs from "fs";
import { rediscover, forgetAnnounce } from "./rediscover.js";
import { windowPids } from "./presence.js";
import { defaultStateDir, newStateDirPath } from "./state-dir.js";
import { platformOptions } from "./webtorrent-platform.js";
import { removeTorrentFolder } from "./remove-folder.js";
import { formatBytes, formatSpeed, selectedProgress } from "./format.js";
import { loadSettings, saveSettings, RESTART_REQUIRED, type AppSettings } from "./settings.js";

/**
 * An incoming peer whose handshake finished after the peer was thrown away.
 *
 * A race inside WebTorrent, reachable any time a torrent stops:
 *
 *   conn-pool.js  onCryptoInfoHash() sets peer.swarm, then AWAITS
 *                 wire.setInfoHash() to finish the encrypted handshake
 *   peer.js:246   destroy() sets this.swarm = null
 *   peer.js:201   handshake() then reads this.swarm.private  ->  TypeError
 *
 * Pause or remove a torrent while an encrypted peer is mid-handshake and the
 * peer is destroyed first; the deferred handshake then runs on a corpse. It
 * escapes as an unhandled rejection, which our catch-all turned into a red
 * error line that looked like the user had broken something.
 *
 * **Benign.** The peer is already gone, the connection is dropped, and no
 * torrent state is touched - there is nothing to do and nothing to tell
 * anyone. Reported after a bulk Pause over four torrents, which destroys four
 * swarms at once and so hits the window almost every time; the same race
 * exists for a single pause, just far more rarely.
 *
 * Matched on the STACK, not the message: the wording differs by engine
 * ("null is not an object (evaluating 'this.swarm.private')" under Bun's
 * JSC, "Cannot read properties of null (reading 'private')" under V8), and
 * the V8 form does not contain the word "swarm" at all.
 *
 * Deliberately narrow - a TypeError raised anywhere else, including elsewhere
 * in peer.js, still reaches the user.
 */
export function isPeerTeardownRace(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const stack = err.stack ?? "";
  return /webtorrent[\\/]lib[\\/]peer\.js/.test(stack) && /\bhandshake\b/.test(stack);
}

export interface TorrentItem {
  id: number;
  name: string;
  size: string;
  progress: string;
  progressRatio: number;
  downSpeed: string;
  upSpeed: string;
  /** Uploaded over downloaded, or "-" before anything has moved. */
  ratio: string;
  status: string;
  /** Why the torrent failed, if it did. Empty otherwise. */
  error: string;
  infoHash: string;
}

/** One entry in the on-disk session index. */
interface PersistedTorrent {
  infoHash: string;
  magnetURI: string;
  savePath: string;
  name: string;
  /** Indices of files the user unticked, so skips survive a restart. */
  skipped?: number[];
}

export interface FileItem {
  index: number;
  name: string;
  path: string;
  size: string;
  progress: string;
  progressRatio: number;
  /** Unticked files are skipped. */
  wanted: boolean;
}

export interface PeerItem {
  address: string;
  /** "webSeed" for HTTP sources, otherwise the wire transport. */
  kind: string;
  downSpeed: string;
  upSpeed: string;
}

/** A torrent being inspected before the user commits to downloading it. */
export interface PreviewInfo {
  id: number;
  infoHash: string;
  name: string;
  size: string;
  /** False until metadata has arrived - a magnet has to fetch it from peers. */
  ready: boolean;
  files: FileItem[];
  /** Tracker-reported seeders, or null before the first announce. */
  seeds: number | null;
  leechers: number | null;
  /** Peers actually connected right now. */
  peers: number;
  /** How long we have been waiting, for "looks dead" messaging. */
  waitedMs: number;
}

/**
 * Does this .torrent actually carry metadata?
 *
 * A torrent file is a bencoded dictionary whose `info` key holds the file
 * list and piece hashes - `4:info` is the literal key as it appears in the
 * bytes. WebTorrent hands out a stub without it while a magnet is still
 * waiting on peers, and that stub is worthless: parse-torrent refuses it, so
 * anything restored from it fails immediately.
 *
 * Checked on the BYTES rather than by parsing, so it stays synchronous and
 * cannot itself throw on the path that writes the session index.
 */
function hasRealMetadata(bytes: Uint8Array): boolean {
  // Buffer.from() is not decoration. WebTorrent hands out a Uint8Array, and
  // Uint8Array.includes() is Array.prototype.includes - it searches for a
  // NUMBER, so includes("4:info") is silently false for every input. Typing
  // the parameter as Buffer hid that; the guard then rejected perfectly good
  // metadata and cached nothing at all.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .includes("4:info");
}

/**
 * A share ratio worth showing, or 0 for "nothing to say yet".
 *
 * Gated on downloaded FILE bytes. WebTorrent's ratio is
 * `uploaded / (received || length)`, and `received` includes protocol and
 * metadata traffic - so a magnet that has served metadata to a few peers
 * while downloading none of the actual torrent reported 151.14 beside a row
 * reading 0 B and 0.0%.
 */
function meaningfulRatio(downloaded: unknown, ratio: unknown): number {
  const bytes = typeof downloaded === "number" ? downloaded : 0;
  if (bytes <= 0) return 0;
  return typeof ratio === "number" && Number.isFinite(ratio) ? ratio : 0;
}

/**
 * Reject an unusable magnet URI before it reaches the client.
 *
 * Exported (not a class method) so the daemon-side engine and the TUI's
 * daemon-engine.ts proxy validate identically without one copying the other -
 * the proxy needs this to fail synchronously too, so a typo does not open an
 * Add dialog that waits forever on metadata that was never coming.
 */
export function validateMagnet(uri: string): string {
  const cleaned = (uri ?? "").trim().replace(/^["']|["']$/g, "");
  if (!cleaned) throw new Error("Missing magnet URI");
  // Reject up front rather than letting parse-torrent fail asynchronously
  // with the opaque "Invalid torrent identifier".
  if (!/^magnet:\?.*xt=urn:bt[im]h:/i.test(cleaned)) {
    throw new Error("Not a magnet link (expected magnet:?xt=urn:btih:...)");
  }
  return cleaned;
}

/**
 * Read and sanity-check a .torrent file, returning its bytes.
 *
 * Used by previewFile(); rejects a bad file before the dialog opens. Exported
 * for the same reason as validateMagnet() above.
 */
export function validateTorrentFile(filePath: string): Buffer {
  if (!filePath) throw new Error("Missing .torrent file path");
  const cleaned = filePath.trim().replace(/^["']|["']$/g, "");
  if (!fs.existsSync(cleaned)) throw new Error("File not found: " + cleaned);
  // Read into a Buffer rather than passing the path string directly -
  // WebTorrent's torrentId type is `Torrent | string | Buffer`; a bare
  // string is ambiguous with magnet URIs/info hashes, but Buffer is
  // unambiguous and explicitly supported.
  if (fs.statSync(cleaned).isDirectory()) throw new Error("That is a folder, not a .torrent file");
  const bytes = fs.readFileSync(cleaned);

  // A .torrent is a bencoded dictionary, so byte 0 must be 'd' (0x64).
  // Checking here turns "Invalid torrent identifier" -- an async unhandled
  // rejection thrown from deep inside parse-torrent, which lands in the
  // debug console as a stack trace -- into an immediate readable error
  // naming the actual file.
  if (bytes[0] !== 0x64) {
    const head = bytes.subarray(0, 16).toString("utf8").trim().toLowerCase();
    throw new Error(
      head.startsWith("<")
        ? "Not a .torrent file (looks like HTML - a failed download?): " + cleaned
        : "Not a valid .torrent file (bad bencode header): " + cleaned,
    );
  }
  return bytes;
}

export interface EngineOptions {
  /** Where downloads land. */
  downloadDir?: string;
  /**
   * Where the session index lives. Injectable so tests NEVER touch the real
   * one - a previous build of this project had a test quietly rewrite the
   * live app's settings and left it rate-limited for days.
   */
  stateDir?: string;
}

export class Engine {
  private client: WebTorrent.Instance;
  private downloadDir: string;
  private stateDir: string;
  private torrentCacheDir: string;
  private indexPath: string;
  /**
   * Stable display ids. The torrents array index is NOT usable as an id:
   * removing a torrent shifts every later entry down, so a queued command
   * like "/remove 2" would silently hit a different torrent than the one
   * the user saw. Ids are assigned once per infoHash and never reused.
   */
  private idByInfoHash = new Map<string, number>();
  private nextId = 0;

  /**
   * infoHashes the user explicitly removed this session. Without this, the
   * "keep everything not currently local" rule in saveSession() would read a
   * just-removed torrent back out of the old index and resurrect it.
   */
  private removedHashes = new Set<string>();
  /** infoHash -> the error that broke it, for the Failed state. */
  private failures = new Map<string, string>();
  /**
   * A torrent being INSPECTED, not yet accepted. It is in the client (that is
   * the only way to fetch metadata for a magnet) but excluded from the
   * torrent list and from the session index until the user says Add.
   */
  private pendingHash: string | null = null;
  private pendingStartedAt = 0;
  /** infoHash -> tracker-reported swarm size. */
  private swarm = new Map<string, { seeds: number; leechers: number }>();
  /** infoHash -> indices of files the user has unticked. */
  private skippedFiles = new Map<string, Set<number>>();
  private settings: AppSettings;
  private downloadDirOverridden = false;

  /**
   * What the last restore() brought back, by infoHash.
   *
   * The count restore() returns is only true at the instant it is called, so
   * a UI that keeps it goes stale - the header went on announcing
   * "Reattached 1 torrent" after that torrent had been resumed or removed.
   * With the identities, a caller can ask what is STILL true.
   */
  private restoredHashes = new Set<string>();

  private errorListener: ((message: string) => void) | undefined;

  constructor(options: EngineOptions = {}) {
    // The env vars exist so the test suites can point the singleton at a
    // temp directory. Without them a test run would write its throwaway
    // torrents into the real session index and they would reappear in the
    // user's app on next launch.
    this.downloadDir = options.downloadDir
      ?? process.env.VI_TORRENT_DOWNLOAD_DIR
      ?? path.join(os.homedir(), "Downloads", "vi-torrent");
    // An explicitly injected download dir always wins over the saved setting,
    // so an isolated test can never be redirected at the real Downloads dir.
    this.downloadDirOverridden = !!(options.downloadDir || process.env.VI_TORRENT_DOWNLOAD_DIR);
    this.stateDir = options.stateDir
      ?? process.env.VI_TORRENT_STATE_DIR
      ?? defaultStateDir();

    // Fail loudly rather than quietly scribbling on the user's real session.
    // tests/_isolate.ts sets VI_TORRENT_TEST, so any engine that still resolves
    // to the live directory inside a test run is a broken import order.
    // Checked BEFORE the client is created - throwing afterwards would leave
    // a live WebTorrent instance holding the event loop open, so the process
    // would hang instead of failing.
    if (process.env.VI_TORRENT_TEST === "1"
        && path.resolve(this.stateDir) === path.resolve(newStateDirPath())) {
      throw new Error(
        "Engine refused to use the real state directory during a test run. " +
        "Import \"./_isolate.js\" as the FIRST import of the test file.",
      );
    }

    this.settings = loadSettings(this.stateDir);
    // Options WebTorrent only reads at construction time - changing any of
    // these in the settings screen therefore says "next launch".
    this.client = new WebTorrent({
      maxConns: this.settings.maxConns,
      dht: this.settings.dht,
      utPex: this.settings.pex,
      lsd: this.settings.lsd,
      secure: this.settings.encryption,
      torrentPort: this.settings.torrentPort,
      natUpnp: this.settings.portForwarding,
      natPmp: this.settings.portForwarding,
      downloadLimit: this.settings.downloadLimit > 0 ? this.settings.downloadLimit : -1,
      uploadLimit: this.settings.uploadLimit > 0 ? this.settings.uploadLimit : -1,
      // Not optional on macOS or Linux - see webtorrent-platform.ts.
      ...platformOptions(),
    } as any);

    this.torrentCacheDir = path.join(this.stateDir, "torrents");
    this.indexPath = path.join(this.stateDir, "session.json");

    // Saved file skips have to be known before anything reads getTorrents().
    for (const entry of this.readIndex()) {
      if (entry.skipped?.length) {
        this.skippedFiles.set(entry.infoHash, new Set(entry.skipped));
      }
    }

    // The session index is rewritten whenever a torrent becomes ready, so an
    // ACCIDENTAL close or a crash loses nothing - there is no "save on exit"
    // step that a killed process could skip.
    this.client.on("torrent", (torrent: any) => {
      // Metadata is ready here, so the file list finally exists and any saved
      // skips can be re-applied.
      this.applySkippedFiles(torrent);
      this.saveSession();
    });
    // WebTorrent reports bad torrent data asynchronously. Without a listener
    // these surface as unhandled rejections that dump a raw stack trace into
    // the debug console overlay instead of telling the user what went wrong.
    this.client.on("error", (err: unknown) => {
      this.report(err);
    });

    // parse-torrent rejects bad torrent data (files AND magnet URIs) from a
    // promise that WebTorrent never surfaces on its own error event, so it
    // escapes as a process-level unhandled rejection and its stack trace
    // lands in the debug console overlay. Catching it here routes it to the
    // inline error display instead. Verified: the "Invalid torrent
    // identifier" case arrives this way, not via client.on("error").
    process.on("unhandledRejection", (reason: unknown) => {
      this.report(reason);
    });
  }

  /**
   * Add a torrent and record any failure against it.
   *
   * Without a per-torrent listener a failure only reaches client.on("error"),
   * which cannot say WHICH torrent broke - so the row would sit there looking
   * healthy forever.
   */
  private addTracked(source: any, options: Record<string, unknown>): any {
    const torrent: any = this.client.add(source, options as any);
    try {
      torrent.on("error", (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (torrent.infoHash) this.failures.set(torrent.infoHash, message);
        this.report(err);
      });
      // A torrent that recovers should stop being marked as failed.
      torrent.on("ready", () => {
        if (torrent.infoHash) this.failures.delete(torrent.infoHash);
        this.watchSwarm(torrent);
      });
      torrent.on("metadata", () => this.watchSwarm(torrent));
    } catch {
      // An engine that cannot attach a listener still works, just without
      // per-torrent failure marking.
    }
    return torrent;
  }

  /**
   * Record tracker-reported swarm size. numPeers only counts peers we have
   * actually connected to; seeders/leechers come from the announce response,
   * and are what tells you a torrent is dead rather than merely slow.
   */
  private watchSwarm(torrent: any): void {
    try {
      const tracker = torrent?.discovery?.tracker;
      if (!tracker?.on) return;
      tracker.on("update", (data: any) => {
        if (!torrent.infoHash) return;
        const seeds = typeof data?.complete === "number" ? data.complete : null;
        const leechers = typeof data?.incomplete === "number" ? data.incomplete : null;
        if (seeds === null && leechers === null) return;
        const previous = this.swarm.get(torrent.infoHash) ?? { seeds: 0, leechers: 0 };
        this.swarm.set(torrent.infoHash, {
          seeds: seeds ?? previous.seeds,
          leechers: leechers ?? previous.leechers,
        });
      });
    } catch {
      // Swarm counts are informational; never let this break adding.
    }
  }

  private report(err: unknown): void {
    if (isPeerTeardownRace(err)) return;
    const raw = err instanceof Error ? err.message : String(err);
    // parse-torrent's own wording is opaque out of context.
    const message = raw.includes("Invalid torrent identifier")
      ? "Invalid torrent: not a readable .torrent file or magnet link"
      : raw;
    this.errorListener?.(message);
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * Matches DaemonEngine's ready() so engine.ts's union type is callable
   * uniformly regardless of which implementation backs it - see engine.ts.
   * There is no daemon to spawn or wait for when this class runs in-process,
   * so it resolves immediately.
   */
  async ready(): Promise<boolean> {
    return true;
  }

  /**
   * Matches DaemonEngine's shutdownDaemon() so engine.ts's union type is
   * callable uniformly - see engine.ts. There is no separate daemon process
   * when this class runs in-process (test mode), so there is nothing to
   * shut down; resolves immediately, true, so a test-mode caller proceeds
   * to close the TUI exactly as the real one would once the real request
   * has landed.
   */
  async shutdownDaemon(): Promise<boolean> {
    return true;
  }

  /**
   * Matches DaemonEngine's armShutdownWhenDone()/isShutdownWhenDoneArmed().
   * No-op here too - there is no separate daemon process to watch anything
   * in test mode, so arming is remembered but genuinely does nothing.
   */
  armShutdownWhenDone(_armed: boolean): void {}
  isShutdownWhenDoneArmed(): boolean { return false; }

  /**
   * Matches DaemonEngine's backendCounts(). No separate daemon process exists
   * in test mode - this Engine instance IS the whole backend - so daemonPid
   * is deliberately null rather than process.pid: there is nothing separate
   * from "the app" to report on. Window pids are still real: presence.ts
   * tracks them off the same stateDir either way.
   */
  backendCounts(): { daemonPid: number | null; windowPids: number[] } {
    return { daemonPid: null, windowPids: windowPids(this.stateDir) };
  }

  /**
   * Options for newly added torrents. The save path comes from settings, but
   * falls back to the constructor's downloadDir so tests that inject a temp
   * directory are never redirected into the user's real Downloads folder.
   */
  private addOptions(): Record<string, unknown> {
    return {
      path: this.downloadDirOverridden ? this.downloadDir : (this.settings.savePath || this.downloadDir),
      ...(this.settings.sequential ? { strategy: "sequential" } : {}),
    };
  }

  /**
   * Persist settings and apply the ones WebTorrent can change on a live
   * client. Returns true if anything changed that only takes effect on the
   * next launch, so the UI can say so rather than pretending it applied.
   */
  applySettings(next: AppSettings): boolean {
    const previous = this.settings;
    this.settings = { ...next };
    saveSettings(this.stateDir, this.settings);

    try {
      const client = this.client as any;
      client.throttleDownload(next.downloadLimit > 0 ? next.downloadLimit : -1);
      client.throttleUpload(next.uploadLimit > 0 ? next.uploadLimit : -1);
      client.maxConns = next.maxConns;
    } catch (e) {
      this.report(e);
    }

    return RESTART_REQUIRED.some(key => previous[key] !== next[key]);
  }

  /**
   * WebTorrent has no seed-ratio enforcement of its own, so pause anything
   * that has given back more than the configured multiple of what it took.
   * Called from getTorrents(), which the UI already polls once a second.
   */
  private enforceSeedRatio(): void {
    const limit = this.settings.seedRatioLimit;
    if (limit <= 0) return;
    for (const t of this.client.torrents) {
      if ((t as any).paused || !t.done) continue;
      // torrent.ratio is uploaded / (received || length) - the library's own
      // definition, so this agrees with what the Ratio column shows.
      const ratio = (t as any).ratio ?? 0;
      if (Number.isFinite(ratio) && ratio >= limit) t.pause();
    }
  }

  /**
   * Is every current torrent DOWNLOADED - deliberately not "and finished
   * seeding too".
   *
   * Seeding and downloading are two different finish lines, and there is no
   * one default that is right for both: `seedRatioLimit` defaults to 0,
   * which the settings screen itself labels "never stop" - gating on it
   * meant a torrent with the DEFAULT settings counted as finished the
   * instant it hit 100%, silently cutting off anyone who genuinely wanted
   * indefinite seeding despite the setting's own name promising otherwise.
   * The other direction is just as wrong: gating on "ratio satisfied"
   * instead would mean this never fires AT ALL for anyone who has not set a
   * ratio limit, which is most people, including the user this was built
   * for, who deliberately does not seed and wants exactly this feature to
   * fire once downloads finish. There is no default that serves both, so
   * this picks one plainly rather than trying to infer intent: downloaded
   * is done. Seeding preference is a separate setting for a separate
   * concern (`seedRatioLimit`, still enforced independently), not something
   * this feature reads at all.
   *
   * Used by the daemon's shutdown-when-done watch, which re-evaluates this
   * on every status tick rather than freezing a set of ids at arm time - a
   * torrent added afterwards still has to finish, and an EMPTY list counts
   * as finished (nothing left to wait for).
   *
   * A torrent that has FAILED does not count as finished and blocks this
   * from ever becoming true - the user asked for "done", and a failure is
   * not that. It also does not silently disappear from consideration, the
   * way skipping it would.
   *
   * "Downloaded" here is the same computation getTorrents() uses to show
   * the Done/Downloading status - selectedProgress() so a torrent with
   * skipped files is judged on the files actually wanted, not the whole
   * payload.
   */
  allFinished(): boolean {
    for (const t of this.client.torrents) {
      if (t.infoHash === this.pendingHash) continue; // a preview, not yet accepted
      if (this.failures.has(t.infoHash)) return false;
      const selected = selectedProgress(
        (t as any).files,
        this.skippedFiles.get(t.infoHash) ?? new Set<number>(),
      );
      const done = selected?.done ?? t.done ?? false;
      if (!done) return false;
    }
    return true;
  }

  /** infoHashes brought back by the last restore(). */
  getRestoredHashes(): Set<string> {
    return new Set(this.restoredHashes);
  }

  /** Register a callback for asynchronous engine errors. */
  onError(listener: (message: string) => void): void {
    this.errorListener = listener;
  }

  private idFor(infoHash: string): number {
    let id = this.idByInfoHash.get(infoHash);
    if (id === undefined) {
      id = this.nextId++;
      this.idByInfoHash.set(infoHash, id);
    }
    return id;
  }

  /** Resolve a display id back to the live torrent, or throw. */
  private torrentById(id: number) {
    if (isNaN(id)) throw new Error("Invalid torrent id");
    const torrent = this.client.torrents.find(t => this.idByInfoHash.get(t.infoHash) === id);
    if (!torrent) throw new Error("No torrent with id " + id);
    return torrent;
  }

  // ---- preview: inspect before committing -------------------------------

  /**
   * Start inspecting a torrent WITHOUT adding it to the session.
   *
   * It has to go into the client - fetching a magnet's file list means asking
   * peers for the metadata, and only a live torrent can do that - but it is
   * held back from getTorrents() and from the session index until confirmed.
   * Added paused so no file data is fetched while the user is still deciding.
   */
  private startPreview(source: any, options: Record<string, unknown>): void {
    this.cancelPreview(); // only one at a time
    // deselect, NOT paused. The preview must download no file data, and
    // pausing looks like the way to get that - but WebTorrent DISCARDS every
    // peer found while a torrent is paused, and a magnet's metadata comes
    // FROM peers. A paused magnet therefore never learns its own file list:
    // the dialog sat on "Fetching metadata from peers..." forever, and the
    // row showed 0 B until it failed. It only ever worked for .torrent files,
    // which carry metadata already.
    //
    // `deselect: true` creates the torrent with no pieces selected, so it
    // connects and accepts metadata while fetching nothing. Measured against
    // a live magnet: metadata arrives, 0.00 MB downloaded, versus 3.89 MB for
    // a normal add over the same interval.
    const torrent = this.addTracked(source, { ...options, deselect: true });
    this.pendingHash = torrent?.infoHash ?? null;
    this.pendingStartedAt = Date.now();
    // A magnet has no infoHash until parse-torrent has run.
    if (!this.pendingHash) {
      torrent?.on?.("infoHash", () => { this.pendingHash = torrent.infoHash; });
    }
  }

  previewMagnet(uri: string): void {
    this.startPreview(validateMagnet(uri), this.addOptions());
  }

  previewFile(filePath: string): void {
    this.startPreview(validateTorrentFile(filePath), this.addOptions());
  }

  /** Live details of the torrent under inspection, or null if none. */
  getPreview(): PreviewInfo | null {
    if (!this.pendingHash) return null;
    const torrent: any = this.client.torrents.find(t => t.infoHash === this.pendingHash);
    if (!torrent) return null;

    const id = this.idFor(torrent.infoHash);
    const counts = this.swarm.get(torrent.infoHash);
    return {
      id,
      infoHash: torrent.infoHash,
      name: torrent.name || "(waiting for metadata)",
      size: torrent.length ? formatBytes(torrent.length) : "-",
      ready: !!torrent.files?.length,
      files: this.getFiles(id),
      seeds: counts?.seeds ?? null,
      leechers: counts?.leechers ?? null,
      peers: torrent.numPeers ?? 0,
      waitedMs: Date.now() - this.pendingStartedAt,
    };
  }

  /**
   * Accept the previewed torrent: apply the file selection, persist it, and
   * let it start. Unticked files are deselected BEFORE it runs, so skipped
   * data is never fetched in the first place.
   */
  confirmPreview(skipped: number[] = []): void {
    if (!this.pendingHash) throw new Error("Nothing to add");
    const infoHash = this.pendingHash;
    const torrent: any = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) throw new Error("Nothing to add");

    if (skipped.length) {
      if (skipped.length >= (torrent.files?.length ?? 0)) {
        throw new Error("At least one file must stay selected");
      }
      this.skippedFiles.set(infoHash, new Set(skipped));
    }

    this.pendingHash = null;
    this.removedHashes.delete(infoHash);

    /**
     * The preview was created with `deselect: true`, so NOTHING is selected -
     * accepting the torrent means selecting what the user kept, rather than
     * deselecting what they dropped.
     */
    const selectWanted = (): void => {
      const skip = this.skippedFiles.get(infoHash) ?? new Set<number>();
      const files = torrent.files ?? [];
      for (const [index, file] of files.entries()) {
        try {
          if (!skip.has(index)) file.select();
        } catch {
          // A file that has gone away cannot be selected; not fatal.
        }
      }
    };

    selectWanted();
    // Adding a magnet and pressing Add before its file list arrives is
    // legitimate - it means "all of it". Without this the torrent would sit
    // at 0% forever with every piece still deselected.
    if (!torrent.files?.length) torrent.once?.("metadata", selectWanted);

    torrent.resume(); // no-op unless something paused it
    rediscover(torrent);
    this.saveSession();
  }

  /**
   * Discard the previewed torrent. destroyStore clears anything already
   * written - metadata fetching can create the save directory - so cancelling
   * genuinely leaves nothing behind.
   */
  cancelPreview(): void {
    if (!this.pendingHash) return;
    const infoHash = this.pendingHash;
    this.pendingHash = null;
    const torrent: any = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) return;
    const savePath = torrent.path ?? this.downloadDir;
    const name = torrent.name ?? "";
    try {
      torrent.destroy({ destroyStore: true }, () => removeTorrentFolder(savePath, name));
    } catch (e) {
      this.report(e);
    }
    this.swarm.delete(infoHash);
    this.failures.delete(infoHash);
    // Otherwise re-adding the torrent within the throttle window would be
    // refused its first announce - the one moment it most needs peers.
    forgetAnnounce(infoHash);
  }

  hasPreview(): boolean {
    return this.pendingHash !== null;
  }

  // -----------------------------------------------------------------------

  /**
   * `torrent.pause()` alone only blocks NEW peer connections - WebTorrent's
   * own `_drain`/`addPeer`/`_addIncomingPeer` all gate on the paused flag,
   * confirmed by reading the installed library (node_modules/webtorrent/
   * lib/torrent.js). Peers already connected at the moment of pausing keep
   * transferring completely unaffected, so the download visibly continued
   * (reported 2026-08-09: status showed Paused, speed kept climbing).
   * Destroying the currently-connected wires actually stops the flow;
   * `resume()` already calls `rediscover()` to find peers again afterward.
   */
  pause(id: number): void {
    const torrent: any = this.torrentById(id);
    torrent.pause();
    for (const wire of torrent.wires ?? []) {
      try {
        wire.destroy();
      } catch {
        // A wire already mid-teardown must not block pausing the rest.
      }
    }
  }

  resume(id: number): void {
    const torrent = this.torrentById(id);
    torrent.resume();
    rediscover(torrent);
  }

  /**
   * Remove a torrent. deleteFiles also erases the downloaded data from disk
   * (WebTorrent's destroyStore); without it the partial/complete files are
   * left in place so the torrent can be re-added and resumed later.
   * The infoHash->id mapping is deliberately kept so the id is retired
   * rather than recycled onto a future torrent.
   */
  remove(id: number, deleteFiles = false): void {
    const torrent = this.torrentById(id);
    const infoHash = torrent.infoHash;
    // Captured before destroy(), which clears them off the torrent.
    const savePath = (torrent as any).path ?? this.downloadDir;
    const name = torrent.name ?? "";

    this.removedHashes.add(infoHash);
    // Re-adding a just-removed torrent must not be refused its first
    // announce by a throttle window it did not earn.
    forgetAnnounce(infoHash);

    if (deleteFiles) {
      // destroyStore removes the files but leaves the folder that held them,
      // so tidy that up once the store has finished with it.
      torrent.destroy({ destroyStore: true }, () => {
        removeTorrentFolder(savePath, name);
      });
    } else {
      torrent.destroy();
    }

    // Drop it from the session too, or the next launch would resurrect a
    // torrent the user explicitly removed.
    this.forgetPersisted(infoHash);
    this.saveSession();
  }

  /**
   * Write the session index plus a copy of each .torrent file.
   *
   * The .torrent bytes are cached deliberately: re-adding from a magnet URI
   * alone would have to fetch metadata from peers before it could verify
   * anything, so a relaunch would sit there doing nothing until the swarm
   * responded. With the metadata on disk, a restored torrent is immediately
   * verifiable and offline-safe.
   */
  private readIndex(): PersistedTorrent[] {
    try {
      if (!fs.existsSync(this.indexPath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // A corrupt index must never stop the app from starting.
    }
  }

  private saveSession(): void {
    try {
      fs.mkdirSync(this.torrentCacheDir, { recursive: true });
      const entries: PersistedTorrent[] = [];
      const seen = new Set<string>();

      for (const t of this.client.torrents) {
        if (!t.infoHash) continue;
        // destroy() does not always drop the torrent from client.torrents
        // before this runs, so honour the explicit removal set.
        if (this.removedHashes.has(t.infoHash)) continue;
        // Never persist a torrent the user has not accepted yet.
        if (t.infoHash === this.pendingHash) continue;
        seen.add(t.infoHash);
        entries.push({
          infoHash: t.infoHash,
          magnetURI: t.magnetURI ?? "",
          savePath: (t as any).path ?? this.downloadDir,
          name: t.name ?? "",
          skipped: [...(this.skippedFiles.get(t.infoHash) ?? [])],
        });
        // Cache ONLY real metadata, and replace a stub once it arrives.
        //
        // WebTorrent exposes `torrentFile` before metadata does: a ~165-byte
        // bencoded stub with no `info` dictionary, which parse-torrent
        // rejects outright ("Torrent is missing required field: info").
        // Writing that, and then never overwriting it because the file
        // existed, poisoned the session permanently - every launch restored
        // an unparseable torrent, which failed instantly, forever. Observed
        // on two real magnets that failed identically on every restart.
        const cached = path.join(this.torrentCacheDir, t.infoHash + ".torrent");
        const bytes = (t as any).torrentFile as Buffer | undefined;
        if (bytes?.length && hasRealMetadata(bytes)) {
          const existing = fs.existsSync(cached) ? fs.statSync(cached).size : -1;
          if (existing !== bytes.length) fs.writeFileSync(cached, bytes);
        }
      }

      // Keep every previously-known torrent that is not in the client right
      // now - the user may simply never have restored it this session. Only
      // an explicit remove() drops an entry, so saving can never lose one.
      for (const previous of this.readIndex()) {
        if (!previous?.infoHash) continue;
        if (seen.has(previous.infoHash)) continue;
        if (this.removedHashes.has(previous.infoHash)) continue;
        entries.push(previous);
      }

      fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2));
    } catch (e) {
      // Persistence is a convenience; never let it take the app down.
      this.report(e);
    }
  }

  /**
   * The best source for re-adding a torrent: its cached metadata, or failing
   * that its magnet URI.
   *
   * A cached file without an `info` dictionary is worse than none - it parses
   * as invalid and fails the torrent instantly - so it is discarded here and
   * the magnet used instead. Deleting it lets the real metadata be cached
   * once it arrives, which is what repairs a session poisoned by an earlier
   * build.
   */
  private cachedOrMagnet(entry: PersistedTorrent): Buffer | string | undefined {
    const cached = path.join(this.torrentCacheDir, entry.infoHash + ".torrent");
    try {
      if (fs.existsSync(cached)) {
        const bytes = fs.readFileSync(cached);
        if (hasRealMetadata(bytes)) return bytes;
        fs.unlinkSync(cached);
      }
    } catch {
      // An unreadable cache entry is simply not usable; fall through.
    }
    return entry.magnetURI || undefined;
  }

  private forgetPersisted(infoHash: string): void {
    try {
      const cached = path.join(this.torrentCacheDir, infoHash + ".torrent");
      if (fs.existsSync(cached)) fs.unlinkSync(cached);
    } catch {
      // A stale cache file is harmless - it is only read for a matching entry.
    }
  }

  /**
   * Re-attach to the torrents from the previous session, all PAUSED.
   *
   * Verified against the real library: WebTorrent hashes whatever is already
   * in the save directory when a torrent is added and reports the true
   * progress, and it does so even when added paused. So a restored torrent
   * shows its real percentage straight away and continues - rather than
   * restarting - the moment the user hits Resume.
   *
   * Returns the number restored.
   */
  restore(): number {
    const entries = this.readIndex();

    let restored = 0;
    this.restoredHashes.clear();
    for (const entry of entries) {
      if (!entry?.infoHash) continue;
      if (this.idByInfoHash.has(entry.infoHash) &&
          this.client.torrents.some(t => t.infoHash === entry.infoHash)) continue;
      try {
        // A cached file that is only a stub must be ignored in favour of the
        // magnet, and deleted so it stops being tried. Sessions written by
        // earlier builds are full of them, and without this they would fail
        // on every launch for as long as the entry survives.
        const source = this.cachedOrMagnet(entry);
        if (!source) continue;
        this.addTracked(source, {
          path: entry.savePath || this.downloadDir,
          paused: true,
        });
        this.restoredHashes.add(entry.infoHash);
        restored++;
      } catch (e) {
        this.report(e);
      }
    }
    return restored;
  }

  private format(
    infoHash: string,
    name: string,
    length: number,
    progress: number,
    downloadSpeed: number,
    uploadSpeed: number,
    paused: boolean,
    done: boolean,
    ratio: number,
  ): TorrentItem {
    return {
      id: this.idFor(infoHash),
      infoHash,
      // No length cap: the table now sizes its own Name column to whatever
      // is actually loaded (see FIXED_COLUMN_WIDTH / the Name-fill logic in
      // app.tsx) and clips cleanly at the terminal edge if it genuinely does
      // not fit - truncating the real name here just fought that, cutting
      // real release names off mid-word ("...Airbender.20") even when the
      // table had room to show the rest.
      name: name || infoHash || "Unknown",
      size: formatBytes(length),
      progress: (progress * 100).toFixed(1) + "%",
      progressRatio: progress,
      downSpeed: formatSpeed(downloadSpeed),
      upSpeed: formatSpeed(uploadSpeed),
      // "-" until something has actually been shared, so a fresh torrent does
      // not display a meaningless 0.00.
      //
      // Callers pass 0 until real file data has arrived. WebTorrent defines
      // ratio as `uploaded / (received || length)`, and `received` counts
      // protocol and METADATA bytes rather than file data - so a magnet that
      // has served metadata to a few peers while downloading nothing reported
      // a ratio of 151.14 next to 0 B and 0.0%.
      ratio: Number.isFinite(ratio) && ratio > 0 ? ratio.toFixed(2) : "-",
      // A magnet has no metadata until peers send it, and until then there is
      // no file list, no size and nothing to download - reporting
      // "Downloading" next to "0 B" invited the reasonable conclusion that
      // the download was broken. Length is the tell: a real torrent always
      // has one. Ordered after Paused so a paused magnet still reads Paused.
      status: this.failures.has(infoHash) ? "Failed"
        : paused ? "Paused"
        : length === 0 ? "Metadata..."
        : done ? "Done" : "Downloading",
      /** Why it failed, for the Details panel. Empty unless status is Failed. */
      error: this.failures.get(infoHash) ?? "",
    };
  }

  /** Files inside a torrent. */
  getFiles(id: number): FileItem[] {
    const torrent: any = this.client.torrents.find(
      t => this.idByInfoHash.get(t.infoHash) === id);
    if (!torrent?.files) return [];
    const skipped = this.skippedFiles.get(torrent.infoHash) ?? new Set<number>();
    return torrent.files.map((f: any, index: number) => ({
      index,
      name: f.name ?? "",
      path: f.path ?? "",
      size: formatBytes(f.length ?? 0),
      progress: ((f.progress ?? 0) * 100).toFixed(1) + "%",
      progressRatio: f.progress ?? 0,
      wanted: !skipped.has(index),
    }));
  }

  /** Connected peers. */
  getPeers(id: number): PeerItem[] {
    const torrent: any = this.client.torrents.find(
      t => this.idByInfoHash.get(t.infoHash) === id);
    if (!torrent?.wires) return [];
    return torrent.wires.map((w: any) => ({
      address: w.remoteAddress ? w.remoteAddress + ":" + (w.remotePort ?? "?") : "(handshaking)",
      kind: w.type ?? "tcp",
      // These are FUNCTIONS on a wire, unlike the torrent-level properties.
      downSpeed: formatSpeed(typeof w.downloadSpeed === "function" ? w.downloadSpeed() : 0),
      upSpeed: formatSpeed(typeof w.uploadSpeed === "function" ? w.uploadSpeed() : 0),
    }));
  }

  /**
   * Include or skip a single file.
   *
   * Caveat worth knowing: BitTorrent pieces do not respect file boundaries, so
   * a skipped file's first and last pieces may still be fetched because a
   * neighbouring wanted file needs them. Skipping saves most of the data, not
   * all of it.
   */
  toggleFile(id: number, fileIndex: number): void {
    const torrent: any = this.client.torrents.find(
      t => this.idByInfoHash.get(t.infoHash) === id);
    if (!torrent?.files?.[fileIndex]) throw new Error("No such file");

    const skipped = this.skippedFiles.get(torrent.infoHash) ?? new Set<number>();
    if (skipped.has(fileIndex)) {
      skipped.delete(fileIndex);
      torrent.files[fileIndex].select();
    } else {
      // Never let the user deselect everything - a torrent with nothing
      // wanted just sits there looking broken.
      if (skipped.size >= torrent.files.length - 1) {
        throw new Error("At least one file must stay selected");
      }
      skipped.add(fileIndex);
      torrent.files[fileIndex].deselect();
    }
    this.skippedFiles.set(torrent.infoHash, skipped);
    this.saveSession();
  }

  /**
   * Include or exclude every file of a running torrent at once.
   *
   * Not a loop over toggleFile: that saves the session on every call, so a
   * torrent with a few thousand files would mean a few thousand synchronous
   * JSON writes for one button press. This selects, then saves once.
   *
   * `keep` is the file left selected when excluding everything - a running
   * torrent with nothing wanted just sits there looking broken, which is the
   * same rule toggleFile enforces. The panel passes the file under the
   * cursor, so the survivor is the one the user can see pointed at rather
   * than an arbitrary choice.
   *
   * Returns how many files changed, so the caller can say nothing happened.
   */
  setAllFiles(id: number, wanted: boolean, keep = 0): number {
    const torrent: any = this.client.torrents.find(
      t => this.idByInfoHash.get(t.infoHash) === id);
    const files = torrent?.files;
    if (!files?.length) throw new Error("No files yet");

    const skipped = this.skippedFiles.get(torrent.infoHash) ?? new Set<number>();
    const survivor = keep >= 0 && keep < files.length ? keep : 0;
    let changed = 0;

    for (const [index, file] of files.entries()) {
      // Everything is wanted, or everything except the one that must stay.
      const want = wanted || index === survivor;
      if (want === !skipped.has(index)) continue;
      try {
        if (want) { skipped.delete(index); file.select(); }
        else { skipped.add(index); file.deselect(); }
        changed++;
      } catch {
        // A file that has gone away cannot be selected either way.
      }
    }

    this.skippedFiles.set(torrent.infoHash, skipped);
    if (changed) this.saveSession();
    return changed;
  }

  /** Re-apply saved file skips once a torrent's metadata is ready. */
  private applySkippedFiles(torrent: any): void {
    const skipped = this.skippedFiles.get(torrent?.infoHash);
    if (!skipped?.size || !torrent?.files) return;
    for (const index of skipped) {
      try { torrent.files[index]?.deselect(); } catch { /* file may be gone */ }
    }
  }

  getTorrents(): TorrentItem[] {
    this.enforceSeedRatio();
    return this.client.torrents
      // A torrent still being previewed is not yours yet.
      .filter(t => t.infoHash !== this.pendingHash)
      .map(t => {
        // Measure against the files the user kept, not the whole torrent -
        // see selectedProgress(). Falls back to WebTorrent's own numbers when
        // nothing is skipped or metadata has not arrived.
        const selected = selectedProgress(
          (t as any).files,
          this.skippedFiles.get(t.infoHash) ?? new Set<number>(),
        );
        return this.format(t.infoHash, t.name ?? "", t.length ?? 0,
          selected?.progress ?? t.progress ?? 0,
          t.downloadSpeed ?? 0, t.uploadSpeed ?? 0, t.paused ?? false,
          selected?.done ?? t.done ?? false,
          meaningfulRatio((t as any).downloaded, (t as any).ratio));
      })
      // Sorted by id, never by position in client.torrents. Rows that move
      // when the underlying array is reordered read as the status column
      // flashing rather than as the rows moving - reported from real use
      // 2026-08-02. Ids are stable and never reused, so this order is fixed
      // for a given set of torrents.
      .sort((a, b) => a.id - b.id);
  }

  destroy(): void {
    // Belt and braces: the index is already written on every change, so a
    // crash is covered too, but a clean exit should capture anything added
    // in the last moments.
    this.saveSession();
    this.client.destroy();
  }
}

