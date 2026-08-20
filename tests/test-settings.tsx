import { checks, settle } from "./_isolate.js";
// Settings: formatting helpers, persistence, live application, and the panel.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import fs from "fs";
import os from "os";
import path from "path";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
import { Engine } from "../src/engine.js";
import { formatBytes, formatSpeed, progressBar, progressSegments } from "../src/format.js";
import { loadSettings, defaultSettings } from "../src/settings.js";
import { FIELDS } from "../src/settings-panel.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const m = async () => {
  const { ck, done } = checks();

  // --- units: the whole point is not showing "6216.98 MB" or "10240 KB/s" ---
  ck("bytes scale to GB", formatBytes(6_518_974_464) === "6.07 GB");
  ck("bytes scale to MB", formatBytes(52_428_800) === "50.0 MB");
  ck("small sizes stay in bytes", formatBytes(512) === "512 B");
  ck("zero is 0 B", formatBytes(0) === "0 B");
  ck("speeds scale too", formatSpeed(10_485_760) === "10.0 MB/s");
  ck("idle speed is a dash, not 0 B/s", formatSpeed(0) === "-");

  ck("progress bar has thick edges and fills", progressBar(1, 10) === "▐██████████▌");
  ck("progress bar keeps its edges when empty", progressBar(0, 10) === "▐░░░░░░░░░░▌");
  ck("progress bar halves", progressBar(0.5, 10) === "▐█████░░░░░▌");
  ck("unknown progress renders as dashes", progressBar(-1, 10) === "▐----------▌");
  // Rounding must not claim a full bar before the download is actually done,
  // nor an empty one once it has genuinely started.
  ck("99.6% is not shown as a full bar", progressBar(0.996, 10) === "▐█████████░▌");
  ck("0.1% still shows a sliver", progressBar(0.001, 10) === "▐█░░░░░░░░░▌");

  // The segments are separate so each can be coloured independently.
  const seg = progressSegments(0.4, 10);
  ck("fill and empty are separate segments", seg.filled === "████" && seg.empty === "░░░░░░");
  ck("edges are separate segments", seg.left === "▐" && seg.right === "▌");

  // --- persistence + live application ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-set-"));
  const stateDir = path.join(root, "state");
  const downloadDir = path.join(root, "downloads");
  const e = new Engine({ stateDir, downloadDir });

  ck("defaults when nothing saved", e.getSettings().maxConns === defaultSettings().maxConns);

  const changedLive = e.applySettings({ ...e.getSettings(), downloadLimit: 512 * 1024, maxConns: 100 });
  ck("changing only live settings does not ask for a restart", changedLive === false);
  ck("settings persisted to disk", loadSettings(stateDir).downloadLimit === 512 * 1024);
  ck("live setting reached the client", (e as any).client.maxConns === 100);
  ck("throttle applied", (e as any).client._downloadLimit === 512 * 1024);

  const changedRestart = e.applySettings({ ...e.getSettings(), dht: false });
  ck("changing a network setting DOES ask for a restart", changedRestart === true);

  // Every stepper must be bounded, or holding a key walks the value forever.
  const unbounded = FIELDS.filter(f => {
    const probe = (f.step as any)(defaultSettings()[f.key], 1);
    // Toggles flip and theme names cycle - only numeric steppers can run away.
    if (typeof probe !== "number") return false;
    // "Bounded" means it reaches a fixed point - stepping again changes
    // nothing. Comparing against some magnitude would just be picking an
    // arbitrary number: the speed ladder legitimately tops out in the
    // millions because it is measured in bytes per second.
    let up: any = probe;
    for (let i = 0; i < 500; i++) up = (f.step as any)(up, 1);
    let down: any = (f.step as any)(defaultSettings()[f.key], -1);
    for (let i = 0; i < 500; i++) down = (f.step as any)(down, -1);
    return (f.step as any)(up, 1) !== up || (f.step as any)(down, -1) !== down;
  }).map(f => f.key);
  ck("every numeric setting is bounded at both ends" +
    (unbounded.length ? " (unbounded: " + unbounded.join(", ") + ")" : ""),
    unbounded.length === 0);

  // A saved setting must actually be used when the engine next starts.
  const e2 = new Engine({ stateDir, downloadDir });
  ck("saved settings load on next launch", e2.getSettings().downloadLimit === 512 * 1024);
  ck("and reach the new client", (e2 as any).client.maxConns === 100);
  e.destroy();
  e2.destroy();
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

  // --- the panel itself ---
  const { renderer, mockMouse, mockInput, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 120, height: 40 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();

  const at = (label: string): [number, number] => {
    const lines = captureCharFrame().split("\n");
    for (let y = 0; y < lines.length; y++) {
      const x = lines[y].indexOf(label);
      if (x >= 0) return [x + 1, y];
    }
    throw new Error("not painted: " + label);
  };

  ck("Settings button is present", captureCharFrame().includes("Settings"));
  ck("panel is hidden until asked for", !captureCharFrame().includes("Max connections"));

  const [sx, sy] = at("Settings");
  await mockMouse.click(sx, sy);
  await s();

  const opened = captureCharFrame();
  ck("clicking Settings opens the panel", opened.includes("Max connections"));
  ck("it lists the speed limits", opened.includes("Download limit") && opened.includes("Upload limit"));
  ck("it lists the network settings", opened.includes("DHT") && opened.includes("Encryption"));
  ck("restart-only settings are marked as such", opened.includes("(next launch)"));
  ck("it explains the controls", opened.includes("left/right change"));
  ck("unlimited is shown as words, not 0", opened.includes("unlimited"));

  // Typing while the panel is open must not leak into the command input
  // sitting behind it.
  await mockInput.typeText("hello");
  await s();
  ck("stray typing does not leak into the command input",
    !captureCharFrame().includes("hello"));

  // Arrows still reach the panel. NOTE: pressKey("down") would send the
  // literal text "down" - the arrow keys need pressArrow().
  mockInput.pressArrow("down");
  mockInput.pressArrow("right");
  await s();
  ck("arrows still drive the panel", captureCharFrame().includes("KB/s"));

  mockInput.pressEscape();
  await s();
  ck("escape closes the panel", !captureCharFrame().includes("Max connections"));

  await mockInput.typeText("/pause");
  await s();
  ck("typing works again once the panel is closed", captureCharFrame().includes("/pause"));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
