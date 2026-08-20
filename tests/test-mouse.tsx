import { addTorrentNow, checks, platformOptions, settle } from "./_isolate.js";
// Mouse: clicking a table row selects it, clicking a suggestion runs it.
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
    // Tall enough for the full suggestion list: 8 commands plus the table.
    await createTestRenderer({ width: 140, height: 44 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();

  // Three small torrents, built offline.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-mouse-"));
  for (let i = 0; i < 3; i++) {
    const f = path.join(root, "f" + i + ".bin");
    fs.writeFileSync(f, Buffer.alloc(32 * 1024, i + 1));
    const b = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
    b.on("error", () => {});
    const t: any = await new Promise(res => b.seed(f, { announce: [] } as any, (x: any) => res(x)));
    const tf = path.join(root, "f" + i + ".torrent");
    fs.writeFileSync(tf, t.torrentFile);
    await new Promise(r => b.destroy(() => r(null)));
    await addTorrentNow(engine, tf);
  }
  await new Promise(r => setTimeout(r, 1600));
  await s();
  ck("three torrents listed", engine.getTorrents().length === 3);

  /**
   * Which rows are TICKED, by name.
   *
   * SEL used to be a radio marker showing a single cursor. It is now a
   * checkbox: clicking a row ticks it and moves the cursor there, and bulk
   * actions run on every ticked row. Arrow keys move the cursor without
   * ticking, so there is still a way to look around without arming anything.
   */
  const tickedNames = (): string[] => {
    const names: string[] = [];
    for (const line of captureCharFrame().split("\n")) {
      if (!line.includes("[x]")) continue;
      const m2 = line.match(/f\d\.bin/);
      if (m2) names.push(m2[0]);
    }
    return names;
  };
  /** Screen row of a torrent's line. */
  const rowY = (name: string): number => {
    const lines = captureCharFrame().split("\n");
    for (let y = 0; y < lines.length; y++) if (lines[y].includes(name)) return y;
    throw new Error("row not painted: " + name);
  };

  // Nothing is armed until the user says so - opening the app must not
  // preselect a torrent that a bulk action would then act on.
  ck("nothing is ticked to begin with", tickedNames().length === 0);

  await mockMouse.click(5, rowY("f2.bin"));
  await s();
  ck("clicking a row ticks it", tickedNames().join() === "f2.bin");

  await mockMouse.click(5, rowY("f1.bin"));
  await s();
  ck("clicking a second row ticks that too, without clearing the first",
    tickedNames().sort().join() === "f1.bin,f2.bin");

  // The whole point of a checkbox: clicking again takes it back off.
  await mockMouse.click(5, rowY("f2.bin"));
  await s();
  ck("clicking a ticked row unticks it", tickedNames().join() === "f1.bin");

  // Clicking the header must not tick anything.
  const headerY = rowY("Status");
  await mockMouse.click(5, headerY);
  await s();
  ck("clicking the header changes nothing", tickedNames().join() === "f1.bin");

  // Selection drives the action buttons, so the click must really have moved it.
  const secondId = engine.getTorrents()[1].id;
  const pauseLine = captureCharFrame().split("\n").findIndex(l => l.includes("Pause"));
  const pauseX = captureCharFrame().split("\n")[pauseLine].indexOf("Pause") + 1;
  await mockMouse.click(pauseX, pauseLine);
  await s();
  ck("Pause acts on the row that was clicked",
    engine.getTorrents().find(t => t.id === secondId)?.status === "Paused");

  // --- clicking a command suggestion ---
  await mockInput.typeText("/");
  await s();
  ck("typing / lists the commands", captureCharFrame().includes("/add-magnet"));

  // The list is capped at 6, so /settings is off-window until we scroll to
  // it. That also exercises the click-to-index mapping under scrolling: a
  // naive mapping would run whatever command sits on that screen line.
  for (let i = 0; i < 7; i++) mockInput.pressArrow("down");
  await s();
  const frame = captureCharFrame();
  ck("scrolling reveals commands past the cap", frame.includes("/settings"));

  const settingsY = frame.split("\n").findIndex(l => l.includes("/settings"));
  const settingsX = frame.split("\n")[settingsY].indexOf("/settings") + 1;
  await mockMouse.click(settingsX, settingsY);
  await s();
  ck("clicking /settings in a scrolled list runs THAT command",
    captureCharFrame().includes("left/right change"));

  mockInput.pressEscape();
  await s();

  // A command that needs an argument should be completed, not run blind.
  await mockInput.typeText("/");
  await s();
  const frame2 = captureCharFrame();
  const addFileY = frame2.split("\n").findIndex(l => l.includes("/add-file"));
  const addFileX = frame2.split("\n")[addFileY].indexOf("/add-file") + 1;
  await mockMouse.click(addFileX, addFileY);
  await s();
  const after = captureCharFrame();
  ck("clicking a command needing an argument completes it instead",
    after.includes("/add-file") && !after.includes("Missing .torrent"));

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
