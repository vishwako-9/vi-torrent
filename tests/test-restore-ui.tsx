import { addTorrentNow, checks, fixtureTorrent, settle } from "./_isolate.js";
// End-to-end: does the APP itself reattach on launch, not just the Engine?
//
// Writes a session with a throwaway Engine pointed at the same isolated
// state dir the singleton will read, then renders App and checks the screen.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { Engine } from "../src/engine.js";

extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const UBUNTU = await fixtureTorrent();

const m = async () => {
  const { ck, done } = checks();
  const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

  // --- previous session ---
  const previous = new Engine({
    stateDir: process.env.VI_TORRENT_STATE_DIR,
    downloadDir: process.env.VI_TORRENT_DOWNLOAD_DIR,
  });
  await addTorrentNow(previous, UBUNTU);
  await settle();
  previous.destroy();
  await settle(800);

  // --- launch the app fresh; importing it now constructs the singleton ---
  const { App } = await import("../src/app.js");
  const { engine } = await import("../src/engine.js");

  const { renderer, captureCharFrame, waitForVisualIdle } = await createTestRenderer({ width: 120, height: 32 });
  await render(() => <App />, renderer);
  await waitForVisualIdle();
  await settle(1800);

  const frame = captureCharFrame();
  ck("the app reattached on launch", engine.getTorrents().length === 1);
  ck("the restored torrent is listed", frame.includes("sample"));
  ck("it is shown as Paused", frame.includes("Paused"));
  ck("the header line says it reattached", frame.includes("Reattached 1 torrent"));

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
