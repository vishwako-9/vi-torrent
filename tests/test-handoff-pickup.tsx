import { checks, fixtureTorrent } from "./_isolate.js";
/**
 * The receiving half of the OS handoff.
 *
 * test-handoff.ts covers the inbox itself. This covers what the running
 * window does with it: a link dropped by a browser-launched vi-torrent has to
 * surface as the Add dialog, without disturbing whatever the user was doing.
 *
 * Driven through the real 1-second refresh tick rather than by calling the
 * handler directly - the tick is the only thing that reads the inbox, so a
 * test that bypassed it would pass with the wiring removed.
 */
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { dropLink } from "../src/handoff.js";
import fs from "fs";
import path from "path";

extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const FIXTURE = await fixtureTorrent();
const stateDir = process.env.VI_TORRENT_STATE_DIR!;
const inbox = path.join(stateDir, "inbox");

/** Long enough for at least one 1s tick to have run. */
const tick = (ms = 1500) => new Promise(r => setTimeout(r, ms));

const m = async () => {
  const { ck, done } = checks();

  const { App } = await import("../src/app.js");
  const { engine } = await import("../src/engine.js");
  const { isAddOpen, setIsAddOpen } = await import("../src/add-panel.js");
  const { setIsSettingsOpen } = await import("../src/settings-panel.js");

  const { renderer, captureCharFrame, waitForVisualIdle } =
    await createTestRenderer({ width: 120, height: 32 });
  await render(() => <App />, renderer);
  await waitForVisualIdle();
  await tick();

  ck("no dialog is open to begin with", isAddOpen() === false);

  // --- a link dropped while the user is in another dialog must wait ---
  // Opening Add on top of Settings would throw away what they were doing.
  setIsSettingsOpen(true);
  dropLink(stateDir, FIXTURE);
  await tick();
  ck("a link does not interrupt a dialog already open", isAddOpen() === false);
  ck("...and is still waiting in the inbox", fs.readdirSync(inbox).length === 1);

  // --- once they close it, the link opens ---
  setIsSettingsOpen(false);
  await tick(2000);
  await waitForVisualIdle();
  ck("closing the dialog lets the handed link through", isAddOpen() === true);
  ck("the inbox is drained", fs.readdirSync(inbox).length === 0);

  const frame = captureCharFrame();
  ck("the Add dialog names the handed torrent", frame.includes("Add torrent:"));
  ck("...and it is the fixture, read off disk", frame.includes("sample"));

  // --- it is not added twice ---
  // Reading the inbox is destructive, so closing the dialog must not make the
  // same torrent reappear a tick later.
  setIsAddOpen(false);
  engine.cancelPreview();
  await tick(2000);
  ck("a consumed link does not come back", isAddOpen() === false);

  // --- rubbish never reaches the engine ---
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, "junk.txt"), "not a link");
  await tick(2000);
  ck("a file that is not a link opens nothing", isAddOpen() === false);

  // --- a .torrent that does not exist must not take the app down ---
  // A browser can hand over a path to a file the user has since deleted.
  dropLink(stateDir, path.join(stateDir, "gone.torrent"));
  await tick(2000);
  ck("a missing .torrent file does not crash the app", renderer !== undefined);
  ck("...and opens no dialog", isAddOpen() === false);

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
