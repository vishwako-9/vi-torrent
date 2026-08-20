/**
 * Persisted app settings.
 *
 * Only knobs WebTorrent genuinely honours are here - a setting that silently
 * does nothing is worse than no setting. Verified against the installed
 * webtorrent (index.js):
 *
 *   LIVE      throttleDownload() / throttleUpload(), maxConns
 *   AT START  dht, utPex, lsd, secure (encryption), torrentPort, natUpnp/natPmp
 *   PER ADD   savePath, sequential strategy
 *   OURS      seedRatioLimit - WebTorrent has no seed-ratio enforcement at all,
 *             so the engine watches ratio and pauses, as the Python client did.
 *
 * Deliberately NOT offered because WebTorrent cannot do them: download
 * queueing / max-active limits, watch folders, move-on-completion, proxy
 * support, and per-torrent speed limits.
 */
import fs from "fs";
import path from "path";
import os from "os";

export interface AppSettings {
  /** Bytes per second. 0 = unlimited. */
  downloadLimit: number;
  uploadLimit: number;
  /** Global peer connection cap. WebTorrent's own default is 55. */
  maxConns: number;
  /** Where new torrents are saved. */
  savePath: string;
  /** Needs a relaunch to take effect. */
  dht: boolean;
  pex: boolean;
  lsd: boolean;
  /** 0 = off, 1 = prefer encrypted, 2 = force encrypted. Needs a relaunch. */
  encryption: 0 | 1 | 2;
  /** 0 = pick a random free port. Needs a relaunch. */
  torrentPort: number;
  /** Ask the router to forward the port. Needs a relaunch. */
  portForwarding: boolean;
  /** Download pieces in order - useful for streaming. Applies to new torrents. */
  sequential: boolean;
  /** Auto-pause once uploaded/downloaded reaches this. 0 = never. */
  seedRatioLimit: number;
  /** Colour theme name - see src/theme.ts. */
  theme: string;
}

/** Settings that only take effect when the app is restarted. */
export const RESTART_REQUIRED: ReadonlyArray<keyof AppSettings> = [
  "dht", "pex", "lsd", "encryption", "torrentPort", "portForwarding",
];

/**
 * Settings that are read when a torrent is ADDED, so changing them leaves
 * everything already in the list alone.
 *
 * These are not restart-required - a relaunch does not apply them either,
 * because they were baked into each torrent when it was added. Without
 * saying so, changing the save path and watching nothing move reads as a
 * bug rather than as the documented behaviour.
 */
export const NEW_TORRENTS_ONLY: ReadonlyArray<keyof AppSettings> = [
  "savePath", "sequential",
];

export function defaultSettings(): AppSettings {
  return {
    downloadLimit: 0,
    uploadLimit: 0,
    maxConns: 55,
    savePath: path.join(os.homedir(), "Downloads", "vi-torrent"),
    dht: true,
    pex: true,
    lsd: true,
    encryption: 1,
    torrentPort: 0,
    portForwarding: true,
    sequential: false,
    seedRatioLimit: 0,
    theme: "aura",
  };
}

export function loadSettings(stateDir: string): AppSettings {
  const file = path.join(stateDir, "settings.json");
  try {
    if (!fs.existsSync(file)) return defaultSettings();
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    // Merge over defaults so a file written by an older version, or one a
    // user has hand-edited badly, cannot leave fields undefined.
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(stateDir: string, settings: AppSettings): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "settings.json"), JSON.stringify(settings, null, 2));
  } catch {
    // Settings are a convenience; never let a failed write take the app down.
  }
}

/** Human-readable value for the settings screen. */
export function describe(key: keyof AppSettings, value: AppSettings[keyof AppSettings]): string {
  if (key === "downloadLimit" || key === "uploadLimit") {
    return value === 0 ? "unlimited" : Math.round((value as number) / 1024) + " KB/s";
  }
  if (key === "encryption") return (["off", "prefer", "require"] as const)[value as 0 | 1 | 2];
  if (key === "torrentPort") return value === 0 ? "random" : String(value);
  if (key === "seedRatioLimit") return value === 0 ? "never stop" : String(value);
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}
