import { checks, platformOptions, settle } from "./_isolate.js";
/**
 * The All / None buttons on the file lists.
 *
 * Driven by real clicks on the painted labels, because the interesting part
 * is the wiring: the buttons are what the user asked for, and a test that
 * called selectAll() directly would pass with them unrendered.
 *
 * The Add dialog deliberately ALLOWS an empty selection - "None, then tick
 * the three I want" is the whole reason None exists. The rule that one file
 * must survive is enforced by Add, and by the engine behind it.
 */
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

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-selall-"));
  const source = path.join(root, "Bundle");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "a.bin"), Buffer.alloc(48 * 1024, 1));
  fs.writeFileSync(path.join(source, "b.bin"), Buffer.alloc(32 * 1024, 2));
  fs.writeFileSync(path.join(source, "c.txt"), "hello");

  const builder = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
  builder.on("error", () => {});
  const built: any = await new Promise(res =>
    builder.seed(source, { announce: [] } as any, (t: any) => res(t)));
  const torrentPath = path.join(root, "bundle.torrent");
  fs.writeFileSync(torrentPath, built.torrentFile);
  await new Promise(r => builder.destroy(() => r(null)));

  const { renderer, mockInput, mockMouse, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 130, height: 38 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 250);
  await s();

  /**
   * Locate a painted label, scanning UPWARDS from the bottom.
   *
   * The buttons sit under the file list, and the dialog TITLE is "Add
   * torrent: ...", so a top-down search for "Add" finds the title and every
   * click lands on a text line that does nothing. That is not hypothetical -
   * it made three checks here pass while testing nothing, because the notice
   * they asserted on was left over from the previous step.
   */
  const at = (label: string): [number, number] => {
    const lines = captureCharFrame().split("\n");
    for (let y = lines.length - 1; y >= 0; y--) {
      const x = lines[y].indexOf(label);
      if (x >= 0) return [x + 1, y];
    }
    throw new Error("not painted: " + label);
  };
  const click = async (label: string) => {
    const [x, y] = at(label);
    await mockMouse.click(x, y);
    await s();
  };

  // --- open the Add dialog ---
  await mockInput.typeText("/add-file " + torrentPath);
  await s();
  mockInput.pressEnter();
  await new Promise(r => setTimeout(r, 2500));
  await s();

  ck("the dialog is open", captureCharFrame().includes("Add torrent"));
  ck("it starts with everything selected", captureCharFrame().includes("3 of 3 selected"));
  ck("an All button is painted", captureCharFrame().includes("All"));
  ck("a None button is painted", captureCharFrame().includes("None"));

  // --- None clears the lot ---
  await click("None");
  const none = captureCharFrame();
  ck("None deselects every file", none.includes("0 of 3 selected"));
  ck("...and says why that cannot be added",
    none.includes("At least one file must stay selected"));

  // --- ticking one back is the point of None ---
  mockInput.pressKey?.("down");
  await s();
  await click("[ ] a.bin");
  const one = captureCharFrame();
  ck("a file can be ticked back on after None", one.includes("1 of 3 selected"));
  ck("the warning clears once something is selected",
    !one.includes("At least one file must stay selected"));

  // --- All restores everything ---
  await click("All");
  ck("All reselects every file", captureCharFrame().includes("3 of 3 selected"));

  // --- None then Add is refused, not silently accepted ---
  await click("None");
  await click("Add");
  const refused = captureCharFrame();
  // None and the refusal print the SAME sentence, so this line alone cannot
  // tell them apart. The two checks under it are what actually pin the
  // behaviour down.
  ck("adding with nothing selected is refused",
    refused.includes("At least one file must stay selected"));
  ck("...and the dialog stays open", refused.includes("Add torrent"));
  ck("...and nothing was added", engine.getTorrents().length === 0);

  // --- a real add still works afterwards ---
  await click("All");
  await click("Add");
  await new Promise(r => setTimeout(r, 1200));
  await s();
  ck("adding after All works", engine.getTorrents().length === 1);
  const files = engine.getFiles(engine.getTorrents()[0].id);
  ck("every file was kept", files.length === 3 && files.every(f => f.wanted));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
