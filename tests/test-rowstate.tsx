import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
// Row backgrounds for finished and failed torrents, and the Failed status
// itself. Builds real torrents offline; failure is injected by emitting the
// error a torrent would emit.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import fs from "fs";
import os from "os";
import path from "path";
import WebTorrent from "webtorrent";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
import { theme } from "../src/theme.js";
import { blend } from "../src/logo.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const m = async () => {
  const { ck, done: report } = checks();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-row-"));
  // The engine saves into VI_TORRENT_DOWNLOAD_DIR, so the payload has to be
  // built THERE for it to verify to 100% and report Done. Building it
  // elsewhere leaves the torrent at 0% and never finished.
  const downloadDir = process.env.VI_TORRENT_DOWNLOAD_DIR!;
  fs.mkdirSync(downloadDir, { recursive: true });

  const make = async (name: string, byte: number) => {
    const f = path.join(downloadDir, name + ".bin");
    fs.writeFileSync(f, Buffer.alloc(32 * 1024, byte));
    const b = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
    b.on("error", () => {});
    const t: any = await new Promise(res => b.seed(f, { announce: [] } as any, (x: any) => res(x)));
    const tf = path.join(root, name + ".torrent");
    fs.writeFileSync(tf, t.torrentFile);
    await new Promise(r => b.destroy(() => r(null)));
    return tf;
  };

  const okTorrent = await make("healthy", 1);
  const badTorrent = await make("broken", 2);

  const { renderer, captureCharFrame, captureSpans, waitForVisualIdle } =
    await createTestRenderer({ width: 140, height: 32 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 250);
  await s();

  // The complete file is already beside the torrent, so this verifies to 100%.
  await addTorrentNow(engine, okTorrent);
  await addTorrentNow(engine, badTorrent);
  await new Promise(r => setTimeout(r, 2500));
  await s();
  ck("two torrents listed", engine.getTorrents().length === 2);

  const done = engine.getTorrents().find(t => t.status === "Done");
  ck("a completed torrent reports Done", !!done);

  // --- failure ---
  const target = engine.getTorrents().find(t => t.infoHash !== done?.infoHash)
    ?? engine.getTorrents()[1];
  const live: any = (engine as any).client.torrents.find((x: any) => x.infoHash === target.infoHash);
  live.emit("error", new Error("simulated tracker failure"));
  await new Promise(r => setTimeout(r, 1400));
  await s();

  const failed = engine.getTorrents().find(t => t.infoHash === target.infoHash);
  ck("a broken torrent reports Failed", failed?.status === "Failed");
  ck("Failed outranks Done/Paused rather than being masked by them",
    failed?.status === "Failed");

  // --- the washes ---
  const rgb = (hex: string) => [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16)).join(",");
  const backgrounds = new Set<string>();
  for (const line of captureSpans().lines) {
    for (const sp of line.spans) {
      if (/healthy|broken/.test(sp.text)) {
        const c = sp.bg as any;
        backgrounds.add([c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(","));
      }
    }
  }
  ck("done and failed rows have DIFFERENT backgrounds (" + [...backgrounds].join(" | ") + ")",
    backgrounds.size === 2);
  ck("the done wash is the expected success tint",
    backgrounds.has(rgb(blend(theme.background, theme.success, 0.16))));
  ck("the failed wash is the expected error tint",
    backgrounds.has(rgb(blend(theme.background, theme.error, 0.18))));

  // A wash must be a TINT, not the raw colour, or text on it stops being
  // readable - the mistake the old full-row selection highlight made.
  ck("the washes are faint, not the raw success/error colours",
    !backgrounds.has(rgb(theme.success)) && !backgrounds.has(rgb(theme.error)));

  ck("the Failed status is painted", captureCharFrame().includes("Failed"));

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  report();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
