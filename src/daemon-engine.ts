/**
 * TUI-side proxy: same public surface as torrent-core.js's Engine, backed by
 * a daemon instead of an in-process WebTorrent client. This is stage 3 of
 * the daemon-first rewrite - see docs/daemon_first_acceptance.md.
 *
 * Reads are SYNCHRONOUS, same as the daemon's own status file has always
 * been read (proven for background rows before this rewrite): DaemonClient
 * reads daemon-status.json off disk with fs.readFileSync, no network call,
 * so getTorrents()/getSettings()/getPreview() can keep the exact signatures
 * app.tsx already calls.
 *
 * Mutations (pause, resume, confirmPreview, ...) are fire-and-forget HTTP
 * POSTs - the method returns immediately, and the effect becomes visible on
 * the NEXT synchronous read once the daemon's status file catches up
 * (typically well under the app's existing 1s refresh tick, since the
 * round trip is localhost). This is not a new compromise: it is exactly how
 * background-owned torrents already behaved for the life of that feature,
 * just now true for every torrent instead of a subset.
 *
 * Per-torrent files/peers are the one read that genuinely cannot be
 * synchronous end-to-end (the daemon does not bake every file of every
 * torrent into the 1s snapshot - see daemon.ts). getFiles()/getPeers() keep
 * their synchronous signatures by returning a small local cache, refreshed
 * by a throttled background fetch. The very first read after opening
 * Details can be empty for a moment - the SAME thing detail-panel.tsx
 * already showed for any background-owned torrent, now resolving within a
 * second instead of never.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { DaemonClient } from "./daemon-client.js";
import { windowPids } from "./presence.js";
import { defaultStateDir } from "./state-dir.js";
import {
  validateMagnet, validateTorrentFile,
  type TorrentItem, type FileItem, type PeerItem, type PreviewInfo,
} from "./torrent-core.js";
import { RESTART_REQUIRED, type AppSettings, loadSettings } from "./settings.js";

/** How stale a cached files/peers read is allowed to get before refetching. */
const DETAIL_POLL_MS = 1000;

export class DaemonEngine {
  private daemon: DaemonClient;
  private stateDir: string;

  private errorListener: ((message: string) => void) | undefined;
  private lastReportedErrorAt = 0;

  private filesCache = new Map<number, FileItem[]>();
  private peersCache = new Map<number, PeerItem[]>();
  private lastDetailFetch = new Map<number, number>();

  constructor(stateDir?: string) {
    this.stateDir = stateDir
      ?? process.env.VI_TORRENT_STATE_DIR
      ?? defaultStateDir();
    this.daemon = new DaemonClient(this.stateDir);
  }

  private daemonScriptPath(): string {
    for (const name of ["daemon.ts", "daemon.js"]) {
      const candidate = fileURLToPath(new URL("./" + name, import.meta.url));
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error("Daemon script not found next to daemon-engine.js");
  }

  /**
   * Make sure a daemon is running and has published at least one status
   * snapshot, spawning one if necessary (N5 in the acceptance doc). Called
   * once from index.tsx BEFORE the component tree mounts - App() reads
   * getSettings() synchronously at the top of its body, so the daemon has to
   * be reachable before then, not lazily on first use.
   *
   * Returns false if the daemon never came up within the timeout. The app
   * still starts either way (N9: surviving a daemon that will not run beats
   * refusing to open at all) - every read degrades to an empty/default
   * value rather than throwing.
   */
  async ready(): Promise<boolean> {
    if (!this.daemon.isRunning()) {
      try {
        this.daemon.spawnDetached(this.daemonScriptPath());
      } catch {
        return false;
      }
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (this.daemon.status()) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  /** Resolve a display id to the infoHash the wire protocol uses. */
  private infoHashFor(id: number): string {
    const t = this.daemon.torrents().find(x => x.id === id);
    if (!t) throw new Error("No torrent with id " + id);
    return t.infoHash;
  }

  getTorrents(): TorrentItem[] {
    const status = this.daemon.status();
    // Piggybacked here because this is the one read guaranteed to run every
    // second regardless of what the UI is showing (app.tsx's own timer calls
    // it via updateTorrents()) - the same reasoning paintHeader() already
    // uses to fold the avatar's running-state check into an existing tick
    // rather than adding a second one.
    const err = status?.error;
    if (err && err.at > this.lastReportedErrorAt) {
      this.lastReportedErrorAt = err.at;
      this.errorListener?.(err.message);
    }
    return status?.torrents ?? [];
  }

  getSettings(): AppSettings {
    // Falls back to reading settings.json directly - the same file the
    // daemon itself loads from - so a dead daemon still shows real saved
    // settings instead of silently reverting to defaults.
    return this.daemon.getSettings() ?? loadSettings(this.stateDir);
  }

  applySettings(next: AppSettings): boolean {
    const previous = this.getSettings();
    void this.daemon.applySettings(next);
    // Computed here, not read back from the daemon: RESTART_REQUIRED is a
    // pure comparison of two settings objects the caller already has both
    // halves of, so there is nothing to gain from waiting on the round trip.
    return RESTART_REQUIRED.some(key => previous[key] !== next[key]);
  }

  getRestoredHashes(): Set<string> {
    return this.daemon.restoredHashes();
  }

  /**
   * The daemon restores its own session on startup (see daemon.ts), so this
   * does not trigger anything - it reports what ready() already caused.
   */
  restore(): number {
    return this.daemon.restoredHashes().size;
  }

  onError(listener: (message: string) => void): void {
    this.errorListener = listener;
  }

  previewMagnet(uri: string): void {
    const cleaned = validateMagnet(uri);
    void this.daemon.previewMagnet(cleaned);
  }

  previewFile(filePath: string): void {
    // Only validated, not sent - the daemon reads the file itself from the
    // same machine, so shipping the bytes over localhost HTTP would just be
    // slower for no benefit. A bad path still fails synchronously here.
    validateTorrentFile(filePath);
    void this.daemon.previewFile(filePath);
  }

  getPreview(): PreviewInfo | null {
    return this.daemon.preview();
  }

  hasPreview(): boolean {
    return this.getPreview() !== null;
  }

  confirmPreview(skipped: number[] = []): void {
    const preview = this.getPreview();
    if (!preview) throw new Error("Nothing to add");
    if (skipped.length && skipped.length >= preview.files.length) {
      throw new Error("At least one file must stay selected");
    }
    void this.daemon.confirmPreview(skipped);
  }

  cancelPreview(): void {
    void this.daemon.cancelPreview();
  }

  pause(id: number): void {
    void this.daemon.pause(this.infoHashFor(id));
  }

  resume(id: number): void {
    void this.daemon.resume(this.infoHashFor(id));
  }

  remove(id: number, deleteFiles = false): void {
    void this.daemon.remove(this.infoHashFor(id), deleteFiles);
  }

  private pollDetail(id: number, infoHash: string): void {
    const now = Date.now();
    const last = this.lastDetailFetch.get(id) ?? 0;
    if (now - last < DETAIL_POLL_MS) return; // fresh enough, or already in flight
    this.lastDetailFetch.set(id, now);
    void this.daemon.getFiles(infoHash).then(files => this.filesCache.set(id, files));
    void this.daemon.getPeers(infoHash).then(peers => this.peersCache.set(id, peers));
  }

  getFiles(id: number): FileItem[] {
    try {
      this.pollDetail(id, this.infoHashFor(id));
    } catch {
      // No such torrent (any more) - fall through to whatever is cached.
    }
    return this.filesCache.get(id) ?? [];
  }

  getPeers(id: number): PeerItem[] {
    try {
      this.pollDetail(id, this.infoHashFor(id));
    } catch {
      // ditto
    }
    return this.peersCache.get(id) ?? [];
  }

  toggleFile(id: number, fileIndex: number): void {
    const files = this.filesCache.get(id) ?? [];
    // Validated against the cache so a bad index fails synchronously, same
    // as the local engine - "No such file" one tick stale is still an honest
    // answer, since the file list itself does not change torrent to torrent.
    if (files.length && !files[fileIndex]) throw new Error("No such file");
    void this.daemon.toggleFile(this.infoHashFor(id), fileIndex);
  }

  /**
   * Returns the count of files that WOULD change, computed against the
   * cached file list with the exact rule torrent-core.js's setAllFiles()
   * itself applies. This is accurate whenever the cache is fresh (true as
   * soon as Details has been open for one poll), not a guess - the daemon
   * applies the identical rule server-side.
   */
  setAllFiles(id: number, wanted: boolean, keep = 0): number {
    const files = this.filesCache.get(id) ?? [];
    if (!files.length) throw new Error("No files yet");
    const survivor = keep >= 0 && keep < files.length ? keep : 0;
    let changed = 0;
    for (const [index, file] of files.entries()) {
      const want = wanted || index === survivor;
      if (want !== file.wanted) changed++;
    }
    void this.daemon.setAllFiles(this.infoHashFor(id), wanted, keep);
    return changed;
  }

  /**
   * A no-op, deliberately. The whole point of the daemon is that it outlives
   * this process - N1/N2 in the acceptance doc say closing the TUI must move
   * or stop nothing. Called from app.tsx's shutdown path, the SIGINT/TERM/HUP
   * handlers in index.tsx, and onCleanup - all of them expect a teardown
   * call to exist, so the method stays, it just has nothing to tear down.
   */
  destroy(): void {}

  /**
   * Stop the daemon itself - every torrent it holds, in every window
   * watching it, not just this one. Not called from destroy()/Quit; those
   * deliberately leave the daemon running (see above). This is the one
   * explicit, user-armed action that actually reaches it - see app.tsx's
   * confirm-armed button and the /shutdown-daemon command, which share one
   * armed signal so either can arm and either can confirm.
   *
   * Returns a Promise, unlike every other mutator here, because app.tsx
   * needs to know the request has actually LANDED before it tears down this
   * window too - a "shutdown" that only stopped the backend while leaving a
   * dead TUI on screen does not match what the word promises. Awaiting the
   * real daemon-client.ts Promise rather than a guessed setTimeout means
   * there is nothing to get wrong about how long is "enough" - the caller
   * genuinely waits for the request to complete, not for a plausible delay.
   */
  async shutdownDaemon(): Promise<boolean> {
    return this.daemon.shutdown();
  }

  /**
   * Arm or cancel "shut down once every torrent has genuinely finished".
   * The watching itself runs entirely in the daemon (see daemon.ts's
   * ticker) - this only flips the flag, and survives this TUI closing on
   * purpose, unlike shutdownDaemon() above which fires immediately.
   */
  armShutdownWhenDone(armed: boolean): void {
    void this.daemon.armShutdownWhenDone(armed);
  }

  /** Is the daemon currently watching, right now - read on the 1s tick like everything else. */
  isShutdownWhenDoneArmed(): boolean {
    return this.daemon.shutdownWhenDoneArmed();
  }

  /**
   * What's actually running in the backend right now: the daemon's own pid
   * (null if it is not reachable) and the pid of every TUI window - this one
   * included - registered against it. Read fresh every tick like everything
   * else here; nothing is cached.
   */
  backendCounts(): { daemonPid: number | null; windowPids: number[] } {
    return { daemonPid: this.daemon.pid(), windowPids: windowPids(this.stateDir) };
  }
}
