import { buildTorrent, checks, settle, testRoot } from "./_isolate.js";
// The header must describe the CURRENT state, not the one it saw at startup.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import fs from "fs";
import path from "path";
import { Engine } from "../src/engine.js";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const REATTACHED = "Reattached";

const m = async () => {
  const { ck, done } = checks();

  // Seed a previous session: add a torrent with a throwaway engine, so the
  // singleton the App uses finds something to restore on mount.
  const source = await buildTorrent(
    path.join(testRoot, "hdr"), "hdr.bin", { "hdr.bin": Buffer.alloc(64 * 1024, 2) });
  const first = new Engine();
  first.previewFile(source);
  await new Promise(r => setTimeout(r, 200));
  first.confirmPreview();
  await new Promise(r => setTimeout(r, 1500));
  first.destroy();
  await new Promise(r => setTimeout(r, 800));

  const indexPath = path.join(process.env.VI_TORRENT_STATE_DIR!, "session.json");
  ck("a previous session was written",
    fs.existsSync(indexPath) && JSON.parse(fs.readFileSync(indexPath, "utf8")).length === 1);

  const { renderer, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 140, height: 32 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 300);
  await new Promise(r => setTimeout(r, 1800));
  await s();

  ck("the reattached torrent is listed", engine.getTorrents().length === 1);
  ck("the header announces the reattach", captureCharFrame().includes(REATTACHED));

  // Remove it. The notice describes torrents that no longer exist, so it has
  // to go - this is the reported bug: an empty table under a header still
  // claiming "Reattached 1 torrent ... click Resume to continue".
  engine.remove(engine.getTorrents()[0].id);
  await new Promise(r => setTimeout(r, 1400));
  await s();

  ck("the table is now empty", engine.getTorrents().length === 0);
  ck("the header no longer claims a reattached torrent",
    !captureCharFrame().includes(REATTACHED));
  ck("it falls back to the normal tagline",
    captureCharFrame().includes("BitTorrent client"));

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
