import { addTorrentNow, buildTorrent, checks, settle, testRoot } from "./_isolate.js";
// The Background dialog: decide, then Save. Nothing happens until you do.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import path from "path";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const source = await buildTorrent(
  path.join(testRoot, "bgp"), "bgp.bin", { "bgp.bin": Buffer.alloc(96 * 1024, 4) });

const m = async () => {
  const { ck, done } = checks();
  const { renderer, captureCharFrame, mockInput, mockMouse, waitForVisualIdle } =
    await createTestRenderer({ width: 140, height: 36 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 250);
  await s();

  await addTorrentNow(engine, source);
  await new Promise(r => setTimeout(r, 1500));
  await s();
  ck("a torrent is listed", engine.getTorrents().length === 1);

  const frame = () => captureCharFrame();
  const clickLabel = async (label: string) => {
    const lines = frame().split("\n");
    const y = lines.findIndex(l => l.includes(label));
    const x = lines[y].indexOf(label) + 1;
    await mockMouse.click(x, y);
    await s();
  };

  /**
   * Click a dialog button, not the first line that happens to say its name.
   *
   * The body explains what Save will do ("On Save: handed to the background
   * downloader"), and that line comes BEFORE the button row - so searching
   * for "Save" alone clicks explanatory text. The button row is the one
   * carrying BOTH buttons. This is the same trap test-addpanel documents,
   * where matching "Add" found the dialog title.
   */
  const clickButton = async (label: string) => {
    const lines = frame().split("\n");
    const y = lines.findIndex(l => l.includes("Save") && l.includes("Cancel"));
    const x = lines[y].indexOf(label) + 1;
    await mockMouse.click(x, y);
    await s();
  };

  ck("the dialog is not open to begin with", !frame().includes("Download in the background"));

  // --- opening it must NOT act ---
  await clickLabel("[ ] Background");
  ck("clicking Background opens a dialog", frame().includes("Download in the background"));
  ck("...and does NOT hand the torrent over on its own",
    engine.getTorrents()[0]?.background === false);
  ck("the dialog offers Save and Cancel",
    frame().includes("Save") && frame().includes("Cancel"));

  // --- ticking the box changes the screen, not the engine ---
  mockInput.pressKey(" ");
  await s();
  ck("space ticks the box on screen", frame().includes("[x]  Download in the background"));
  ck("...but the engine is still untouched",
    engine.getTorrents()[0]?.background === false);
  ck("the dialog says what Save will do",
    frame().includes("handed to the background downloader"));

  // --- Cancel discards ---
  await clickButton("Cancel");
  ck("Cancel closes the dialog", !frame().includes("Download in the background"));
  ck("Cancel changed nothing", engine.getTorrents()[0]?.background === false);

  // --- Save applies ---
  await clickLabel("[ ] Background");
  mockInput.pressKey(" ");
  await s();
  await clickButton("Save");
  await new Promise(r => setTimeout(r, 400));
  await s();
  ck("Save closes the dialog", !frame().includes("Download in the background"));
  ck("Save actually applies the change",
    engine.getTorrents()[0]?.background === true);

  // --- and back off again through the same dialog ---
  // The BG button is disabled mid-handover, so wait for it to settle first.
  await new Promise(r => setTimeout(r, 1200));
  await s();
  await clickLabel("Background");
  ck("re-opening shows the box already ticked",
    frame().includes("[x]  Download in the background"));
  mockInput.pressKey(" ");
  await s();
  ck("unticking previews taking it back",
    frame().includes("taken back into this window"));
  await clickButton("Save");
  await new Promise(r => setTimeout(r, 1500));
  await s();
  ck("saving the untick brings it back", engine.getTorrents()[0]?.background === false);
  ck("and the row is still there", engine.getTorrents().length === 1);

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
