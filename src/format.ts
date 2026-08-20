/**
 * Human-readable sizes and speeds.
 *
 * Everything used to be hard-coded to MB and KB/s, which made a 6 GB torrent
 * read "6216.98 MB" and a genuinely fast download read "10240.0 KB/s" - the
 * exact figure you would then struggle to compare against another client
 * quoting MB/s.
 */
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // Whole numbers for bytes and for anything three digits or wider, so the
  // column stays narrow: "938 MB", "6.07 GB", "512 B".
  const decimals = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(decimals) + " " + UNITS[unit];
}

/** Idle transfers render as "-" rather than a noisy "0 B/s". */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "-";
  return formatBytes(bytesPerSecond) + "/s";
}

export interface ProgressSegments {
  /** Thick left edge. */
  left: string;
  /** The completed portion. */
  filled: string;
  /** The remaining portion - a light shade, so it reads as empty. */
  empty: string;
  /** Thick right edge. */
  right: string;
}

/**
 * The pieces of a progress bar, kept separate so each can be given its own
 * colour when rendered into a table cell:
 *
 *   ▐████░░░░░░▌  40%
 *
 * Half-block glyphs make a heavier edge than brackets would, and they sit
 * flush against the fill. ratio < 0 means "unknown" - used by the row shown
 * while a torrent is being handed to the background downloader.
 */
export function progressSegments(ratio: number, width = 10): ProgressSegments {
  if (!Number.isFinite(ratio) || ratio < 0) {
    return { left: "▐", filled: "", empty: "-".repeat(width), right: "▌" };
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  // Only a genuinely finished torrent gets a completely full bar, and only a
  // genuinely untouched one gets a completely empty bar - rounding must not
  // claim 100% at 99.6%.
  let filled = Math.round(clamped * width);
  if (filled === width && clamped < 1) filled = width - 1;
  if (filled === 0 && clamped > 0) filled = 1;
  return {
    left: "▐",
    filled: "█".repeat(filled),
    empty: "░".repeat(width - filled),
    right: "▌",
  };
}

/** The same bar as a plain string, for contexts without per-chunk colour. */
/** The subset of a WebTorrent file this calculation needs. */
export interface SelectableFile {
  length: number;
  downloaded: number;
  done: boolean;
}

/**
 * Progress and completion over the files the user actually WANTS.
 *
 * WebTorrent measures both against the whole torrent:
 *
 *   get progress () { return this.downloaded / this.length }   // length = every file
 *   const done = this.files.every(file => file.done)           // including skipped ones
 *
 * So a torrent with files deselected could never reach 100% and could never
 * report done - skip half the bytes and the bar sticks at 50% forever, the
 * status stays "Downloading", and the row never turns green. The client was
 * passing those numbers straight through, so it inherited that definition.
 *
 * Returns null when there is nothing to measure yet - no metadata, or nothing
 * skipped - and the caller should use WebTorrent's own values.
 */
export function selectedProgress(
  files: SelectableFile[] | undefined,
  skipped: Set<number>,
): { progress: number; done: boolean } | null {
  if (!files?.length || skipped.size === 0) return null;

  let total = 0;
  let got = 0;
  let allDone = true;
  let wanted = 0;

  for (const [index, file] of files.entries()) {
    if (skipped.has(index)) continue;
    wanted++;
    total += file.length ?? 0;
    got += file.downloaded ?? 0;
    if (!file.done) allDone = false;
  }

  // Every file skipped should be impossible - both the Add dialog and
  // toggleFile refuse it - but dividing by zero here would put NaN in the
  // progress bar rather than failing visibly.
  if (wanted === 0) return null;

  return {
    progress: total > 0 ? Math.min(1, got / total) : 0,
    done: allDone,
  };
}

export function progressBar(ratio: number, width = 10): string {
  const s = progressSegments(ratio, width);
  return s.left + s.filled + s.empty + s.right;
}
