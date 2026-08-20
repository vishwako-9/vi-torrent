/**
 * Import this FIRST in every test file:
 *
 *   import "./_isolate.js";
 *
 * It redirects the engine singleton's session index and download directory
 * into a throwaway temp folder. ESM evaluates imports in declaration order,
 * so as long as this is the first import it runs before src/engine.ts is
 * loaded and the singleton is constructed.
 *
 * This is not optional hygiene. An earlier build of this project had a smoke
 * test write into the live app's settings and left the real client
 * rate-limited with DHT disabled for days. Now that the engine persists a
 * session, an unisolated test would additionally inject its throwaway
 * torrents into the user's next real launch.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { platformOptions } from "../src/webtorrent-platform.js";

/**
 * Re-exported so suites can reach it WITHOUT adding a second import above
 * `./_isolate.js`.
 *
 * Every `new WebTorrent(...)` in the tests needs it or the suite panics on
 * POSIX - but importing it directly puts a line before the isolation import,
 * and that import has to be first (see the note at the top of this file).
 * Routing it through here keeps one rule instead of two.
 */
export { platformOptions };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-test-"));

process.env.VI_TORRENT_STATE_DIR = path.join(root, "state");
process.env.VI_TORRENT_DOWNLOAD_DIR = path.join(root, "downloads");
// Engine throws if it still resolves to the real ~/.vi-torrent while this is
// set, so a bad import order fails loudly instead of leaking silently.
process.env.VI_TORRENT_TEST = "1";

process.on("exit", () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Temp dir cleanup is best-effort.
  }
});

export const testRoot = root;

/**
 * PASS/FAIL reporting and the exit code, in one place.
 *
 * Every suite had its own copy of these four lines plus the tail block.
 * `done()` prints the summary the sweep script greps for and exits.
 */
export function checks() {
  let fails = 0;
  const ck = (label: string, ok: boolean): void => {
    console.log((ok ? "PASS" : "FAIL") + " - " + label);
    if (!ok) fails++;
  };
  const done = (): never => {
    console.log(fails === 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
    process.exit(fails === 0 ? 0 : 1);
  };
  return { ck, done };
}

/** Let the renderer catch up, then pause for anything on a timer. */
export async function settle(waitForVisualIdle: () => Promise<unknown>, ms = 250): Promise<void> {
  await waitForVisualIdle();
  await new Promise(r => setTimeout(r, ms));
}

/**
 * Build a .torrent from real bytes, offline.
 *
 * `entries` keyed by relative path: one entry whose key is the name gives a
 * single-file torrent, several give a multi-file one. The seeding client is
 * destroyed before returning, so nothing is left serving.
 */
export async function buildTorrent(
  dir: string,
  name: string,
  entries: Record<string, Buffer | string>,
): Promise<string> {
  const { default: WebTorrent } = await import("webtorrent");
  const keys = Object.keys(entries);
  const single = keys.length === 1 && keys[0] === name;
  const target = single ? path.join(dir, name) : path.join(dir, name);

  if (single) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, entries[name] as any);
  } else {
    for (const [relative, contents] of Object.entries(entries)) {
      const file = path.join(target, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents as any);
    }
  }

  const builder = new (WebTorrent as any)({ dht: false, tracker: false, lsd: false, ...platformOptions() });
  builder.on("error", () => {});
  const torrent: any = await new Promise(res =>
    builder.seed(target, { announce: [] }, (t: any) => res(t)));
  const torrentPath = path.join(dir, name + ".torrent");
  fs.writeFileSync(torrentPath, torrent.torrentFile);
  await new Promise(r => builder.destroy(() => r(null)));
  return torrentPath;
}

/**
 * The shared sample torrent, built once per suite from bytes on disk.
 *
 * Suites used to point at a real ubuntu .torrent sitting outside the repo,
 * which meant the tests only ran on the one machine that had it. This builds
 * an equivalent offline, so a fresh clone can run the suite.
 */
export const FIXTURE_NAME = "sample.bin";
let fixturePromise: Promise<string> | undefined;
export function fixtureTorrent(): Promise<string> {
  fixturePromise ??= buildTorrent(path.join(root, "fixtures"), FIXTURE_NAME, {
    [FIXTURE_NAME]: Buffer.alloc(512 * 1024, 7),
  });
  return fixturePromise;
}

/** "r,g,b" of a hex colour, for comparing against painted spans. */
export function rgbOf(hex: string): string {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(",");
}

/** Every distinct foreground colour a glyph is painted in, as "r,g,b". */
export function spanColours(captureSpans: () => any, needle: string): string[] {
  const found = new Set<string>();
  for (const line of captureSpans().lines) {
    for (const span of line.spans) {
      if (span.text.includes(needle)) {
        const c = span.fg;
        found.add([c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(","));
      }
    }
  }
  return [...found];
}

/**
 * Add a torrent the way the app does - preview, then confirm - in one call.
 *
 * The engine has no immediate-add API any more: /add-file and /add-magnet
 * both open the Add dialog, so tests go through the same path.
 */
export async function addTorrentNow(engine: any, source: string): Promise<void> {
  if (source.startsWith("magnet:")) engine.previewMagnet(source);
  else engine.previewFile(source);
  // Long enough for parse-torrent to produce an infoHash; confirmPreview only
  // needs the torrent to exist, not to have full metadata.
  await new Promise(r => setTimeout(r, 60));
  engine.confirmPreview();
}
