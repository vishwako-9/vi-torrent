/**
 * Client side of the daemon's control channel.
 *
 * Status is read SYNCHRONOUSLY from the status file the daemon rewrites every
 * second, so a caller's own refresh tick can show live progress without any
 * async work in the render path. Commands go over the daemon's localhost HTTP
 * channel and are fire-and-forget.
 *
 * The wire types are the daemon's own torrent-core.js types, not a parallel
 * set kept in sync by hand - the daemon's snapshot IS core.getTorrents() /
 * core.getPreview() / core.getSettings(), unchanged.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { TorrentItem, PreviewInfo, FileItem, PeerItem } from "./torrent-core.js";
import type { AppSettings } from "./settings.js";

export interface DaemonStatus {
  pid: number;
  updatedAt: number;
  torrents: TorrentItem[];
  preview: PreviewInfo | null;
  /** infoHashes restore() brought back on the daemon's last (re)start. */
  restored: string[];
  settings: AppSettings;
  error: { message: string; at: number } | null;
  /** Is the daemon currently watching for "everything finished" to self-exit? */
  shutdownWhenDoneArmed: boolean;
}

interface DaemonHandle {
  pid: number;
  port: number;
  token: string;
}

/** A status snapshot older than this means the daemon is gone or wedged. */
const STALE_MS = 8000;

export class DaemonClient {
  constructor(private stateDir: string) {}

  private get daemonPath(): string { return path.join(this.stateDir, "daemon.json"); }
  private get statusPath(): string { return path.join(this.stateDir, "daemon-status.json"); }

  private read<T>(file: string): T | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private handle(): DaemonHandle | null {
    const h = this.read<DaemonHandle>(this.daemonPath);
    if (!h?.port || !h?.token || !h?.pid) return null;
    try {
      process.kill(h.pid, 0); // liveness check only - signal 0 sends nothing
    } catch {
      return null;
    }
    return h;
  }

  /** Is a daemon running right now? */
  isRunning(): boolean {
    return this.handle() !== null;
  }

  pid(): number | null {
    return this.handle()?.pid ?? null;
  }

  /**
   * The full status snapshot, or null when no daemon is running and also
   * when its status file has gone stale - a frozen snapshot presented as
   * live progress would be worse than showing nothing.
   */
  status(): DaemonStatus | null {
    if (!this.handle()) return null;
    const status = this.read<DaemonStatus>(this.statusPath);
    if (!status?.torrents) return null;
    if (Date.now() - (status.updatedAt ?? 0) > STALE_MS) return null;
    return status;
  }

  torrents(): TorrentItem[] { return this.status()?.torrents ?? []; }
  preview(): PreviewInfo | null { return this.status()?.preview ?? null; }
  restoredHashes(): Set<string> { return new Set(this.status()?.restored ?? []); }
  getSettings(): AppSettings | null { return this.status()?.settings ?? null; }
  lastError(): { message: string; at: number } | null { return this.status()?.error ?? null; }
  shutdownWhenDoneArmed(): boolean { return this.status()?.shutdownWhenDoneArmed ?? false; }

  private async command(endpoint: string, body: Record<string, unknown> = {}): Promise<boolean> {
    const h = this.handle();
    if (!h) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vi-torrent-token": h.token },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async get<T>(endpoint: string): Promise<T | null> {
    const h = this.handle();
    if (!h) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}${endpoint}`, {
        headers: { "x-vi-torrent-token": h.token },
      });
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }

  /**
   * The command still in flight for each queue key.
   *
   * Every command is its own HTTP request and callers fire them without
   * awaiting, so pressing two buttons quickly can send two overlapping POSTs
   * with NO ordering guarantee. If they land in the wrong order the daemon
   * ends up in the opposite state to the last button pressed.
   *
   * Keyed per torrent for torrent commands, and under a fixed key for the
   * single-preview and settings commands (there is only ever one preview and
   * one settings document, so they get one queue each). Different torrents
   * never wait on each other.
   */
  private queues = new Map<string, Promise<unknown>>();

  private serialise<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    // .then(run, run): a failed command must not strand every later one
    // behind a rejected promise.
    const next = previous.then(run, run);
    const settled = next.catch(() => {});
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }

  pause(infoHash: string): Promise<boolean> {
    return this.serialise(infoHash, () => this.command("/pause", { infoHash }));
  }
  resume(infoHash: string): Promise<boolean> {
    return this.serialise(infoHash, () => this.command("/resume", { infoHash }));
  }
  remove(infoHash: string, deleteFiles = false): Promise<boolean> {
    return this.serialise(infoHash, () => this.command("/remove", { infoHash, deleteFiles }));
  }
  toggleFile(infoHash: string, fileIndex: number): Promise<boolean> {
    return this.serialise(infoHash, () => this.command("/files/toggle", { infoHash, fileIndex }));
  }
  setAllFiles(infoHash: string, wanted: boolean, keep = 0): Promise<boolean> {
    return this.serialise(infoHash, () => this.command("/files/set-all", { infoHash, wanted, keep }));
  }

  previewMagnet(uri: string): Promise<boolean> {
    return this.serialise("__preview__", () => this.command("/preview/magnet", { uri }));
  }
  previewFile(filePath: string): Promise<boolean> {
    return this.serialise("__preview__", () => this.command("/preview/file", { path: filePath }));
  }
  confirmPreview(skipped: number[] = []): Promise<boolean> {
    return this.serialise("__preview__", () => this.command("/preview/confirm", { skipped }));
  }
  cancelPreview(): Promise<boolean> {
    return this.serialise("__preview__", () => this.command("/preview/cancel"));
  }

  applySettings(settings: AppSettings): Promise<boolean> {
    return this.serialise("__settings__", () => this.command("/settings", { settings }));
  }

  /**
   * Arm or cancel the daemon's own watch for "everything finished" - once
   * armed it keeps checking on its own ticker and shuts itself down when
   * true, independent of whether this or any other TUI is still open.
   */
  armShutdownWhenDone(armed: boolean): Promise<boolean> {
    return this.serialise("__shutdown_when_done__", () => this.command("/shutdown-when-done", { armed }));
  }

  /** On-demand reads, not part of the 1s status poll - called only while the Details panel is open. */
  getFiles(infoHash: string): Promise<FileItem[]> {
    return this.get<{ files: FileItem[] }>(`/files?infoHash=${encodeURIComponent(infoHash)}`)
      .then(r => r?.files ?? []);
  }
  getPeers(infoHash: string): Promise<PeerItem[]> {
    return this.get<{ peers: PeerItem[] }>(`/peers?infoHash=${encodeURIComponent(infoHash)}`)
      .then(r => r?.peers ?? []);
  }

  // Not serialised: it is not about one torrent, and it must not queue behind
  // commands for a daemon that is being told to stop.
  shutdown(): Promise<boolean> { return this.command("/shutdown"); }

  /**
   * Launch the daemon, detached, so it survives this terminal closing.
   * Verified on Windows: detached + stdio ignore + unref keeps the child
   * alive after the parent exits; windowsHide stops a console flashing.
   */
  spawnDetached(daemonScript: string): void {
    const child = spawn(process.execPath, ["run", daemonScript, "--state", this.stateDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
}
