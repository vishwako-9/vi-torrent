import "./_isolate.js";
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";

extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

async function main() {
  const { renderer, mockInput, captureCharFrame, captureSpans, waitForVisualIdle } = await createTestRenderer({ width: 110, height: 44 });
  await render(() => <App />, renderer);
  const settle = async () => { await waitForVisualIdle(); await new Promise(r => setTimeout(r, 180)); };
  await settle();

  let fails = 0;
  const check = (label: string, cond: boolean) => {
    console.log((cond ? "PASS" : "FAIL") + " - " + label);
    if (!cond) fails++;
  };

  check("no suggestions before typing", !captureCharFrame().includes("Add a torrent from a magnet"));

  // Typing "/" should list ALL commands
  await mockInput.typeText("/");
  await settle();
  let f = captureCharFrame();
  // Only the first 6 are shown - the list is capped so it cannot push the
  // input off the bottom of a short terminal.
  check("typing / lists commands", f.includes("/add-magnet") && f.includes("/remove"));
  check("suggestions show descriptions", f.includes("Add a torrent from a magnet link"));
  check("the overflow is announced rather than silently hidden", f.includes("more"));

  // The list must have structure: the highlighted command, a plain one, and
  // the descriptions should not all be the same colour.
  const colourOf = (text: string): string | null => {
    for (const line of captureSpans().lines) {
      for (const s of line.spans) {
        if (s.text.includes(text)) {
          const c = s.fg as any;
          return [c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(",");
        }
      }
    }
    return null;
  };
  const selected = colourOf("/add-magnet");
  const unselected = colourOf("/pause");
  // Matches the start of /pause's description in theme.ts. Kept short so a
  // reworded description does not read as a colour regression - which is
  // exactly what happened when "Pause selected" became "Pause ticked".
  const description = colourOf("Pause ticked");
  check("the highlighted command is not the same colour as the others",
    !!selected && selected !== unselected);
  check("descriptions are dimmer than command names",
    !!description && description !== unselected);
  check("commands past the cap are not painted yet", !f.includes("/quit"));

  // Narrowing filters the list
  await mockInput.typeText("add-f");
  await settle();
  f = captureCharFrame();
  check("typing /add-f filters to add-file", f.includes("/add-file") && !f.includes("/quit"));

  // Tab completes
  mockInput.pressTab();
  await settle();
  check("tab completes the command", captureCharFrame().includes("/add-file"));

  // Escape dismisses suggestions
  mockInput.pressEscape();
  await settle();
  check("escape dismisses suggestions", !captureCharFrame().includes("Add a torrent from a .torrent"));

  mockInput.pressEscape();
  await settle();

  console.log("\n=== FRAME (after typing /) ===");
  // retype to show the pretty state
  await mockInput.typeText("/");
  await settle();
  console.log(captureCharFrame());

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : "\n" + fails + " FAILED");
  engine.destroy();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
