import { checks, settle } from "./_isolate.js";
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });
const m = async () => {
  const { renderer, mockInput, captureCharFrame, waitForVisualIdle } = await createTestRenderer({ width: 100, height: 30 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 180);
  await s();
  const { ck, done } = checks();

  // /pause with NO argument and no torrent: should RUN (and report the
  // "No torrent selected" error), not silently re-complete forever.
  await mockInput.typeText("/pause");
  await s();
  mockInput.pressEnter();
  await s();
  ck("argument-less command runs on first Enter", captureCharFrame().includes("No torrent selected"));

  // A command with a REQUIRED arg should still complete, not run.
  await mockInput.typeText("/add-fi");
  await s();
  mockInput.pressEnter();
  await s();
  ck("required-arg command completes instead of running", captureCharFrame().includes("/add-file"));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
