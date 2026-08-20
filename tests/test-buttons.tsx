import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
// Clicks the real button row in the real App, with a real torrent loaded.
// Click coordinates are derived from the painted frame, never guessed.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const UBUNTU = await fixtureTorrent();

const m = async () => {
  const { renderer, mockMouse, mockInput, captureCharFrame, captureSpans, waitForVisualIdle } =
    await createTestRenderer({ width: 110, height: 34 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();
  const { ck, done } = checks();

  const at = (label: string): [number, number] => {
    const lines = captureCharFrame().split("\n");
    for (let y = 0; y < lines.length; y++) {
      const x = lines[y].indexOf(label);
      if (x >= 0) return [x + 1, y];
    }
    throw new Error("button not painted: " + label);
  };
  const click = async (label: string) => { const [x, y] = at(label); await mockMouse.click(x, y); await s(); };

  // The torrent table repaints on a 1s timer, so adding a torrent straight
  // through the engine (rather than via /add-file) is not visible to the UI
  // immediately. Wait for the row to actually appear before clicking.
  const addAndWait = async () => {
    await addTorrentNow(engine, UBUNTU);
    await new Promise(r => setTimeout(r, 1400)); // > the 1s table refresh
    await s();
  };

  const frame0 = captureCharFrame();
  ck("button row is rendered", ["Pause", "Resume", "Remove", "Remove + Files", "Quit"].every(b => frame0.includes(b)));

  // With nothing selected the torrent buttons are disabled, so clicking one
  // must be a no-op -- no action, and no error message either.
  await click("Pause");
  ck("disabled button is inert when no torrent is selected",
    !captureCharFrame().includes("No torrent selected") && engine.getTorrents().length === 0);

  await addAndWait();
  ck("torrent loaded", engine.getTorrents().length === 1);

  await click("Pause");
  ck("Pause button pauses the selected torrent", engine.getTorrents()[0].status === "Paused");

  await click("Resume");
  ck("Resume button resumes it", engine.getTorrents()[0].status !== "Paused");

  // --- the destructive button requires a second, deliberate click ---
  await click("Remove + Files");
  ck("first click on Remove + Files does NOT delete", engine.getTorrents().length === 1);
  ck("armed state is visible to the user", captureCharFrame().includes("Click again to delete"));

  await click("Click again to delete");
  ck("second click removes the torrent", engine.getTorrents().length === 0);

  // --- arming is per-torrent, and plain Remove keeps the files ---
  await addAndWait();
  await click("Remove + Files");
  ck("re-armed on the new torrent", captureCharFrame().includes("Click again to delete"));
  await click("Pause");
  ck("clicking another button disarms the delete", !captureCharFrame().includes("Click again to delete"));

  await click("Remove");
  ck("Remove button removes from the list", engine.getTorrents().length === 0);

  // --- hover feedback (the only cue that these are clickable at all) ---
  const quitColor = (): string => {
    for (const line of captureSpans().lines) {
      for (const span of line.spans) {
        if (span.text.includes("Quit")) {
          const c = span.fg as any;
          return [c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(",");
        }
      }
    }
    throw new Error("Quit label not found in spans");
  };

  const [qx, qy] = at("Quit");
  await mockMouse.moveTo(1, 1);
  await s();
  const cold = quitColor();
  await mockMouse.moveTo(qx, qy);
  await s();
  const hot = quitColor();
  ck("hovering a button changes its colour (" + cold + " -> " + hot + ")", cold !== hot);

  await mockMouse.moveTo(1, 1);
  await s();
  ck("moving away restores it", quitColor() === cold);

  // --- Shutdown daemon: same two-click confirm pattern, no torrent needed ---
  // (it is a global action, not one scoped to a selection).
  ck("the shutdown button is rendered", captureCharFrame().includes("Shutdown daemon"));

  await click("Shutdown daemon");
  ck("first click does not fire it (armed state visible)",
    captureCharFrame().includes("Click again: shutdown daemon"));
  ck("the risk is explained", captureCharFrame().includes("ALL downloads"));

  // Escape backs out without confirming - matches Remove + Files disarming
  // on any other action, not just a timeout.
  mockInput.pressEscape();
  await s();
  ck("Escape disarms it back to the unarmed label",
    captureCharFrame().includes("Shutdown daemon") &&
    !captureCharFrame().includes("Click again: shutdown daemon"));

  // --- the /shutdown-daemon command shares the SAME armed state as the button ---
  await mockInput.typeText("/shutdown-daemon");
  mockInput.pressEnter();
  await s();
  ck("the command arms it too", captureCharFrame().includes("Click again: shutdown daemon"));
  ck("closing this window is part of what it warns about",
    captureCharFrame().includes("closes this window"));

  // Deliberately NOT clicked through to a real confirm: shutdownDaemon() now
  // closes this window too (matches Quit - a real shutdown, not the backend
  // dying while a dead TUI stays lit), which calls process.exit(0) for
  // real - there is no test-mode guard on that, by design, so it has to
  // actually exit for the behaviour to be genuine. No test in this suite
  // clicks Quit through to completion for the identical reason; disarming
  // here instead proves the same shared-state claim (arm via command,
  // confirm via button would be the SAME signal) without ending the process.
  mockInput.pressEscape();
  await s();
  ck("disarming after a shared arm leaves the app running, same as Quit is never clicked through",
    captureCharFrame().includes("Shutdown daemon") &&
    !captureCharFrame().includes("Click again: shutdown daemon"));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
