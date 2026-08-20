import { checks, platformOptions, settle } from "./_isolate.js";
// The "Add torrent" dialog: inspect before committing, choose files, and
// cancel without leaving anything behind.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import fs from "fs";
import os from "os";
import path from "path";
import WebTorrent from "webtorrent";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const m = async () => {
  const { ck, done } = checks();

  // A real multi-file torrent, built offline.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-add-"));
  const source = path.join(root, "Bundle");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "keep.bin"), Buffer.alloc(48 * 1024, 1));
  fs.writeFileSync(path.join(source, "skip.bin"), Buffer.alloc(32 * 1024, 2));
  fs.writeFileSync(path.join(source, "notes.txt"), "hello");

  const builder = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
  builder.on("error", () => {});
  const built: any = await new Promise(res =>
    builder.seed(source, { announce: [] } as any, (t: any) => res(t)));
  const torrentPath = path.join(root, "bundle.torrent");
  fs.writeFileSync(torrentPath, built.torrentFile);
  await new Promise(r => builder.destroy(() => r(null)));

  const { renderer, mockInput, mockMouse, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 130, height: 36 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 250);
  await s();

  // --- /add-file opens the dialog instead of adding ---
  await mockInput.typeText("/add-file " + torrentPath);
  await s();
  mockInput.pressEnter();
  await new Promise(r => setTimeout(r, 2500));
  await s();

  const open = captureCharFrame();
  ck("the dialog opens rather than adding straight away", open.includes("Add torrent"));
  ck("nothing is in the torrent list yet", engine.getTorrents().length === 0);
  ck("the engine knows a preview is in flight", engine.hasPreview());

  const info = engine.getPreview();
  ck("metadata loaded", info?.ready === true);
  ck("the torrent name is shown", open.includes("Bundle"));
  ck("all three files are listed", info?.files.length === 3);
  ck("file sizes are shown", open.includes("KB"));
  ck("the swarm line is shown", open.includes("seeders"));
  ck("it explains the controls above the list", open.includes("right include") && open.includes("left skip"));
  ck("it has Add and Cancel buttons", open.includes("Add") && open.includes("Cancel"));
  ck("every file starts selected", open.includes("3 of 3 selected"));

  // --- mouse: click a file row to toggle it ---
  const lineOf = (text: string): number =>
    captureCharFrame().split("\n").findIndex(l => l.includes(text));
  // Click ON the text. The dialog is inset, so a low x lands on the table
  // behind it and the click is silently swallowed.
  const clickOn = async (text: string) => {
    const y = lineOf(text);
    const x = captureCharFrame().split("\n")[y].indexOf(text) + 1;
    await mockMouse.click(x, y);
  };
  await clickOn("skip.bin");
  await s();
  ck("clicking a file row unticks it", captureCharFrame().includes("2 of 3 selected"));
  await clickOn("skip.bin");
  await s();
  ck("clicking it again ticks it back", captureCharFrame().includes("3 of 3 selected"));

  // --- keyboard: left skips, right includes, space flips ---
  mockInput.pressArrow("down");
  await s();
  mockInput.pressArrow("left");
  await s();
  ck("left skips the highlighted file", captureCharFrame().includes("2 of 3 selected"));
  mockInput.pressArrow("right");
  await s();
  ck("right includes it again", captureCharFrame().includes("3 of 3 selected"));
  mockInput.pressKey(" ");
  await s();
  ck("space flips it", captureCharFrame().includes("2 of 3 selected"));

  // --- mouse: the Add button ---
  // The button row, not the title - "Add torrent: ..." contains "Add" too and
  // comes first on screen.
  const clickButton = async (label: string) => {
    const lines = captureCharFrame().split("\n");
    const y = lines.findIndex(l => l.includes("Add") && l.includes("Cancel"));
    await mockMouse.click(lines[y].indexOf(label) + 1, y);
  };
  await clickButton("Add");
  await new Promise(r => setTimeout(r, 1200));
  await s();

  ck("the dialog closes on add", !captureCharFrame().includes("Add torrent"));
  ck("the torrent is now in the list", engine.getTorrents().length === 1);
  ck("no preview is left in flight", !engine.hasPreview());

  const added = engine.getTorrents()[0];
  const files = engine.getFiles(added.id);
  ck("the unticked file is skipped", files.filter(f => !f.wanted).length === 1);
  ck("the others are kept", files.filter(f => f.wanted).length === 2);
  ck("it is not left paused after adding", added.status !== "Paused");

  const persisted = JSON.parse(
    fs.readFileSync(path.join(process.env.VI_TORRENT_STATE_DIR!, "session.json"), "utf8"));
  ck("the accepted torrent is persisted", persisted.length === 1);
  ck("the file skip is persisted too", persisted[0]?.skipped?.length === 1);

  // --- cancel leaves nothing behind ---
  await mockInput.typeText("/add-file " + torrentPath);
  await s();
  mockInput.pressEnter();
  await new Promise(r => setTimeout(r, 1500));
  await s();
  // Same infoHash as the one already added, so the preview should be the only
  // thing that changed; cancel it.
  await clickButton("Cancel");
  await new Promise(r => setTimeout(r, 1200));
  await s();

  ck("cancelling closes the dialog", !captureCharFrame().includes("Add torrent"));
  ck("cancelling leaves no preview", !engine.hasPreview());
  const after = JSON.parse(
    fs.readFileSync(path.join(process.env.VI_TORRENT_STATE_DIR!, "session.json"), "utf8"));
  ck("cancelling does not add a session entry", after.length === persisted.length);

  engine.destroy();
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
