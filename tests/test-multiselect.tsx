import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
/**
 * Tick several torrents, act on all of them at once.
 *
 * SEL was a radio marker showing one cursor, and every action read that one
 * index. It is now a checkbox, and actions run over every ticked row - so
 * pausing eight torrents is one click rather than eight.
 *
 * The rule that keeps the old workflow intact: **nothing ticked means the
 * action applies to the cursor row**. Without that fallback, pausing a single
 * torrent would require ticking it first, which is worse than what this
 * replaced. That fallback is asserted here, not assumed.
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

  const { renderer, mockMouse, mockInput, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 150, height: 46 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-multi-"));
  for (let i = 0; i < 3; i++) {
    const f = path.join(root, "m" + i + ".bin");
    fs.writeFileSync(f, Buffer.alloc(32 * 1024, i + 1));
    const b = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
    b.on("error", () => {});
    const t: any = await new Promise(res => b.seed(f, { announce: [] } as any, (x: any) => res(x)));
    const tf = path.join(root, "m" + i + ".torrent");
    fs.writeFileSync(tf, t.torrentFile);
    await new Promise(r => b.destroy(() => r(null)));
    await addTorrentNow(engine, tf);
  }
  await new Promise(r => setTimeout(r, 1600));
  await s();
  ck("three torrents listed", engine.getTorrents().length === 3);

  /** Buttons sit under the table; scan upwards so a row name cannot match. */
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
  const rowY = (name: string): number => {
    const lines = captureCharFrame().split("\n");
    for (let y = 0; y < lines.length; y++) if (lines[y].includes(name)) return y;
    throw new Error("row not painted: " + name);
  };
  const tickCount = () => (captureCharFrame().match(/\[x\]/g) ?? []).length;
  const paused = () => engine.getTorrents().filter(t => t.status === "Paused").length;

  // --- nothing is armed on launch ---
  ck("nothing is ticked to begin with", tickCount() === 0);

  // --- All / None ---
  await click("All");
  ck("All ticks every torrent", tickCount() === 3);
  ck("the header shows how many are ticked",
    captureCharFrame().split("\n").some(l => l.includes("Name") && l.includes("3")));

  // --- one click pauses all three ---
  await click("Pause");
  ck("Pause acts on every ticked torrent", paused() === 3);

  await click("Resume");
  ck("Resume acts on every ticked torrent", paused() === 0);

  await click("None");
  ck("None clears the ticks", tickCount() === 0);

  // --- THE FALLBACK: nothing ticked acts on the cursor row ---
  // This is what keeps single-torrent use as cheap as it was before.
  await click("Pause");
  ck("with nothing ticked, Pause acts on the cursor row only", paused() === 1);
  await click("Resume");
  ck("...and Resume takes it back", paused() === 0);

  // --- partial selection ---
  await mockMouse.click(5, rowY("m0.bin"));
  await s();
  await mockMouse.click(5, rowY("m2.bin"));
  await s();
  ck("two rows can be ticked without the third", tickCount() === 2);
  await click("Pause");
  ck("only the ticked torrents are paused", paused() === 2);
  const byName = (n: string) => engine.getTorrents().find(t => t.name.includes(n));
  ck("the untouched torrent is still running", byName("m1")?.status !== "Paused");
  await click("Resume");

  // --- slash commands do the same thing ---
  await click("None");
  await mockInput.typeText("/select-all");
  await s();
  mockInput.pressEnter();
  await s();
  ck("/select-all ticks everything", tickCount() === 3);
  await mockInput.typeText("/select-none");
  await s();
  mockInput.pressEnter();
  await s();
  ck("/select-none clears them", tickCount() === 0);

  // --- delete confirmation names the count and disarms on change ---
  await click("All");
  await click("Remove + Files");
  const armed = captureCharFrame();
  ck("arming a bulk delete says how many", armed.includes("delete 3"));
  ck("nothing is deleted on the first click", engine.getTorrents().length === 3);

  // Changing the selection must disarm - deleting a set the user did not
  // confirm is the one mistake here that cannot be undone.
  await mockMouse.click(5, rowY("m1.bin"));
  await s();
  ck("changing the selection disarms the delete",
    !captureCharFrame().includes("Click again"));
  ck("...and still nothing was deleted", engine.getTorrents().length === 3);

  // --- a real bulk delete ---
  await click("None");
  await click("All");
  await click("Remove + Files");
  await click("Click again");
  await s();
  await new Promise(r => setTimeout(r, 600));
  await s();
  ck("confirming removes every ticked torrent", engine.getTorrents().length === 0);
  ck("the ticks are cleared with them", tickCount() === 0);

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
