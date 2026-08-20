import { addTorrentNow, buildTorrent, checks, settle, testRoot } from "./_isolate.js";
// The Background button must be unclickable while a torrent is changing hands.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import path from "path";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const source = await buildTorrent(
  path.join(testRoot, "btn"), "btn.bin", { "btn.bin": Buffer.alloc(128 * 1024, 9) });

const m = async () => {
  const { ck, done } = checks();
  const { renderer, mockInput, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 140, height: 34 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 250);
  await s();

  await addTorrentNow(engine, source);
  await new Promise(r => setTimeout(r, 1500));
  await s();
  ck("a torrent is listed", engine.getTorrents().length === 1);

  const frameHas = (needle: string) => captureCharFrame().includes(needle);

  ck("before ticking, the button offers an empty checkbox", frameHas("[ ] Background"));
  ck("and does not claim a handover is in progress", !frameHas("handing over"));

  // Tick it. The local torrent is released immediately and the background
  // downloader has not started yet, so for a moment it belongs to neither
  // side - the row reads "Starting..." and the action is impossible.
  engine.toggleBackground(engine.getTorrents()[0].id);
  await s();

  ck("the row reports the handover", engine.getTorrents()[0]?.status === "Starting...");
  ck("the button says so rather than offering a checkbox", frameHas("... handing over"));
  ck("the checkbox label is gone while it is in flight",
    !frameHas("[x] Background") && !frameHas("[ ] Background"));

  // Untick again - the engine cancels the pending handover and takes it back.
  engine.toggleBackground(engine.getTorrents()[0].id);
  await new Promise(r => setTimeout(r, 1200));
  await s();

  const rows = engine.getTorrents();
  ck("the row is still there after cancelling", rows.length === 1);
  ck("and is no longer flagged for background", rows[0]?.background === false);
  ck("the button offers the empty checkbox again", frameHas("[ ] Background"));
  ck("and no longer claims a handover", !frameHas("handing over"));

  // --- "Stop background" during a handover ---
  //
  // It is NOT disabled in that window, on purpose: it releases every
  // background torrent, so with several running you must still be able to
  // stop the others. It routes through the same toggleBackground() the fix
  // repaired, so it has to be safe mid-flight - proven here rather than
  // assumed.
  engine.toggleBackground(engine.getTorrents()[0].id);
  await s();
  ck("handover in flight again", engine.getTorrents()[0]?.status === "Starting...");
  ck("Stop background is still offered while handing over",
    frameHas("Stop background"));

  engine.stopBackground();
  await new Promise(r => setTimeout(r, 1200));
  await s();

  const after = engine.getTorrents();
  ck("Stop background mid-handover keeps the row", after.length === 1);
  ck("...unflagged", after[0]?.background === false);
  ck("...and owned locally again, not stranded", after[0]?.remote === false);
  ck("...with no background downloader left running",
    engine.backgroundRunning() === false);

  // --- one torrent in transit must not disable the button for the others ---
  //
  // The disable was written for a single selection and used `some`, so once
  // several could be ticked, one torrent mid-handover locked the user out of
  // every other one. Reported from real use: nine ticked, all handing over,
  // every control dead except "Stop background".
  const second = await buildTorrent(
    path.join(testRoot, "btn2"), "btn2.bin", { "btn2.bin": Buffer.alloc(96 * 1024, 3) });
  await addTorrentNow(engine, second);
  await new Promise(r => setTimeout(r, 1200));
  await s();
  ck("two torrents listed", engine.getTorrents().length === 2);

  await mockInput.typeText("/select-all");
  await s();
  mockInput.pressEnter();
  await s();

  engine.toggleBackground(engine.getTorrents()[0].id);
  await s();
  const mixed = engine.getTorrents();
  ck("one is in transit", mixed.some(t => t.status === "Starting..."));
  ck("...and the other is not", mixed.some(t => t.status !== "Starting..."));
  ck("the button stays usable when only SOME targets are in transit",
    !frameHas("... handing over"));

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
