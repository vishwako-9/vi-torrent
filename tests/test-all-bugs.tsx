import { fixtureTorrent } from "./_isolate.js";
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";

extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const TORRENT_FILE = await fixtureTorrent();

const settle = async (waitForVisualIdle: () => Promise<void>) => {
  await waitForVisualIdle();
  await new Promise((r) => setTimeout(r, 200));
};

async function main() {
  const { renderer, mockInput, captureCharFrame, waitForVisualIdle } = await createTestRenderer({
    width: 110,
    height: 40,
  });
  await render(() => <App />, renderer);
  await settle(waitForVisualIdle);

  let failures = 0;
  const check = (label: string, cond: boolean) => {
    console.log((cond ? "PASS" : "FAIL") + " - " + label);
    if (!cond) failures++;
  };

  // BUG 1: TUI takes input
  await mockInput.typeText("/badcommand");
  await settle(waitForVisualIdle);
  check("typing appears in input", captureCharFrame().includes("badcommand"));

  // Error path renders (proves reactivity + imperative visible toggle)
  mockInput.pressEnter();
  await settle(waitForVisualIdle);
  check("error message renders on bad command", captureCharFrame().includes("Unknown command"));

  // The ctrl+p command palette was removed: the inline "/" list does the
  // same job, is discoverable, and is clickable. Its checks went with it.

  // BUG 4: /add-file adds a torrent - now via the Add dialog, which opens
  // first so the user can inspect it and pick files. Enter accepts.
  const before = engine.getTorrents().length;
  await mockInput.typeText("/add-file " + TORRENT_FILE);
  await settle(waitForVisualIdle);
  mockInput.pressEnter();
  await new Promise(r => setTimeout(r, 2500));
  await settle(waitForVisualIdle);
  check("/add-file opens the Add dialog", captureCharFrame().includes("Add torrent"));
  check("nothing is added until confirmed", engine.getTorrents().length === before);

  mockInput.pressEnter();
  await new Promise(r => setTimeout(r, 1200));
  await settle(waitForVisualIdle);
  const after = engine.getTorrents().length;
  check("confirming adds the torrent (" + before + " -> " + after + ")", after === before + 1);
  check("torrent name appears in table", captureCharFrame().toLowerCase().includes("sample"));

  // /add-file with a bad path surfaces an error instead of silently doing nothing
  await mockInput.typeText("/add-file C:\\nope\\missing.torrent");
  await settle(waitForVisualIdle);
  mockInput.pressEnter();
  await settle(waitForVisualIdle);
  check("/add-file bad path shows error", captureCharFrame().includes("File not found"));

  console.log("\n=== FINAL FRAME ===");
  console.log(captureCharFrame());
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED");

  engine.destroy();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST SCRIPT ERROR:", e);
  process.exit(1);
});
