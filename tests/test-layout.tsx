import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
// Responsive layout: nothing may overlap anything else, at any terminal size.
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

/**
 * The prompt is the assertion that matters.
 *
 * When the layout overflowed, the boxes above it were laid out past the
 * bottom of the screen and painted straight through this line: it came out as
 * "❯Type─/─for┴commands..." with the table's borders threaded through the
 * words. So: find the prompt line, and require it to be clean.
 */
const BOX_DRAWING = /[─│┌┐└┘├┤┬┴┼╭╮╰╯█]/;

const promptLine = (frame: string): string =>
  frame.split("\n").find(l => l.includes("Type / for commands")) ?? "";

/**
 * Present AND unpolluted, in one assertion.
 *
 * These must not be two separate checks: without the scrollbox the prompt is
 * pushed off the bottom of the screen entirely, and a "no box-drawing on the
 * prompt line" check then passes on an empty string. Overflow has two shapes -
 * painted over, or pushed off - and both are failures.
 */
const promptIsIntact = (frame: string): boolean => {
  const line = promptLine(frame);
  return line !== "" && !BOX_DRAWING.test(line);
};

const m = async () => {
  const { ck, done } = checks();
  const { renderer, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 120, height: 30 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 300);
  await s();

  /**
   * Resize, then wait until the frame actually reflects it.
   *
   * One settle() is enough on an idle machine and not on a busy one - this
   * suite failed intermittently in the full sweep while passing every time
   * on its own. Polling keeps the assertions exactly as strict (if the
   * condition never holds, the check still fails); it just stops them
   * depending on how loaded the machine is.
   */
  const resizeTo = async (
    width: number, height: number, expected?: (frame: string) => boolean,
  ): Promise<string> => {
    renderer.resize(width, height);
    let frame = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      await s();
      frame = captureCharFrame();
      if (!expected || expected(frame)) break;
    }
    return frame;
  };

  // --- roomy terminal: the full header is on show ---
  let frame = captureCharFrame();
  ck("the block logo is painted when there is room", frame.includes("████████"));
  ck("the prompt is intact at 120x30", promptIsIntact(frame));

  // --- short terminal: the header goes, the working parts stay ---
  //
  // Checks for "SEL" (the table's first column), not "Status" (its last).
  // Every column now holds its real, non-shrinking width - see
  // FIXED_COLUMN_WIDTH in app.tsx - so a genuinely correct Progress/Status/
  // etc. column needs real horizontal room; at 100 columns with the
  // Backend sidebar also taking its own fixed width, the far end of the
  // table can legitimately clip off rather than lie about its width. That
  // is the intended trade-off (accurate columns over silently shrinking
  // them to fit), not a regression - "SEL" is what genuinely proves the
  // table itself survived the resize, independent of how much of it fits.
  frame = await resizeTo(100, 10, f => f.includes("SEL"));
  ck("the logo is dropped when the terminal is too short", !frame.includes("████████"));
  ck("the table is still there", frame.includes("SEL"));
  ck("the prompt survives a 10-row terminal intact", promptIsIntact(frame));

  // --- narrow terminal: every button is still reachable ---
  frame = await resizeTo(60, 18, f => f.includes("Quit"));
  for (const label of ["Pause", "Remove + Files", "Details", "Settings", "Quit"]) {
    ck("the " + label + " button wraps rather than being cut off", frame.includes(label));
  }
  ck("the prompt is intact at 60x18", promptIsIntact(frame));

  // --- tiny terminal ---
  frame = await resizeTo(45, 12);
  ck("the prompt is intact at 45x12", promptIsIntact(frame));

  // --- more rows than the window has: the table must clip, not bleed ---
  // This is what the scrollbox is for. Hiding the header buys back a few
  // rows, but nothing bounds a torrent list - with a plain box, five
  // torrents in a 14-row terminal painted the table straight through the
  // prompt ("❯Type)/ for]commands...n │32.0 KB │...").
  renderer.resize(90, 14);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-layout-"));
  for (let i = 0; i < 5; i++) {
    const payload = path.join(root, "f" + i + ".bin");
    fs.writeFileSync(payload, Buffer.alloc(32 * 1024, i + 1));
    const seeder = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
    seeder.on("error", () => {});
    const built: any = await new Promise(res =>
      seeder.seed(payload, { announce: [] } as any, (t: any) => res(t)));
    const torrentFile = path.join(root, "f" + i + ".torrent");
    fs.writeFileSync(torrentFile, built.torrentFile);
    await new Promise(r => seeder.destroy(() => r(null)));
    await addTorrentNow(engine, torrentFile);
  }
  // Poll rather than sleeping a fixed 1600ms. Five torrents land quickly on
  // an idle machine and not always inside that window during the full sweep,
  // where this suite failed intermittently while passing every time on its
  // own. The assertion below is unchanged - if they never arrive it still
  // fails; it just no longer depends on machine load.
  for (let attempt = 0; attempt < 40 && engine.getTorrents().length < 5; attempt++) {
    await new Promise(r => setTimeout(r, 200));
  }
  await s();
  frame = captureCharFrame();
  ck("five torrents are loaded", engine.getTorrents().length === 5);
  ck("more rows than fit leaves the prompt intact", promptIsIntact(frame));

  // --- and back: growing the window restores what was dropped ---
  frame = await resizeTo(120, 30, f => f.includes("████████"));
  ck("the logo comes back when the terminal is enlarged", frame.includes("████████"));
  ck("the prompt is still intact after resizing back", promptIsIntact(frame));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
