import { checks, settle } from "./_isolate.js";
// Colour themes: /theme command, the picker, live repaint, and persistence.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
import { theme, THEMES, THEME_NAMES, applyTheme, currentThemeName } from "../src/theme.js";
import { loadSettings } from "../src/settings.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const m = async () => {
  const { ck, done } = checks();

  // --- the palette object is shared by reference, not copied ---
  const before = theme.accent;
  ck("more than one theme exists", THEMES.length >= 4);
  ck("aura is the default", currentThemeName() === "aura");

  ck("applying a known theme succeeds", applyTheme("nord"));
  ck("the shared theme object was mutated in place", theme.accent !== before);
  ck("it reports the new name", currentThemeName() === "nord");
  ck("an unknown theme is rejected", applyTheme("does-not-exist") === false);
  ck("a rejected theme leaves the palette alone", currentThemeName() === "nord");
  ck("every theme defines every colour",
    THEMES.every(t => Object.keys(THEMES[0].palette).every(k => !!(t.palette as any)[k])));

  applyTheme("aura");

  // --- through the app ---
  const { renderer, mockInput, captureCharFrame, captureSpans, waitForVisualIdle } =
    await createTestRenderer({ width: 120, height: 40 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();

  // Scans from the BOTTOM: the input prompt is the last "❯" on screen. The
  // suggestion list and the theme picker use the same glyph as their cursor,
  // so a top-down scan finds those instead and reports their colour.
  const promptColour = (): string => {
    const lines = captureSpans().lines;
    for (let i = lines.length - 1; i >= 0; i--) {
      for (const span of lines[i].spans) {
        if (span.text.includes("❯")) {
          const c = span.fg as any;
          return [c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(",");
        }
      }
    }
    return "none";
  };

  await mockInput.typeText("/theme");
  await s();
  ck("typing /theme suggests it", captureCharFrame().includes("Change the colour theme"));

  const coral = promptColour();
  mockInput.pressEnter();
  await s();

  const opened = captureCharFrame();
  ck("/theme with no argument opens Settings", opened.includes("left/right change"));
  ck("Theme is the row it lands on", opened.includes("❯ Theme"));
  ck("the theme's description is shown as its hint",
    opened.includes(THEMES[0].description));

  // Cycling the value previews the theme live.
  mockInput.pressArrow("right");
  await s();
  const previewed = promptColour();
  ck("cycling the theme repaints the app live", previewed !== coral && previewed !== "none");
  ck("it moved to the next theme", currentThemeName() === THEMES[1].name);
  ck("and its description followed", captureCharFrame().includes(THEMES[1].description));

  // Escape restores what was active when Settings opened.
  mockInput.pressEscape();
  await s();
  ck("escape reverts the live preview", currentThemeName() === "aura");
  ck("and the colours go back", promptColour() === coral);

  // Commit one for real.
  await mockInput.typeText("/theme");
  await s();
  mockInput.pressEnter();
  await s();
  mockInput.pressArrow("right");
  mockInput.pressArrow("right");
  await s();
  const chosen = currentThemeName();
  mockInput.pressEnter();
  // Saving shows a confirmation and closes on a short delay, so give it more
  // than the usual settle time before asserting the panel has gone.
  await new Promise(r => setTimeout(r, 900));
  await s();

  ck("enter keeps the previewed theme", currentThemeName() === chosen);
  ck("Settings closed", !captureCharFrame().includes("left/right change"));
  ck("the choice was persisted",
    loadSettings(process.env.VI_TORRENT_STATE_DIR!).theme === chosen);

  // Direct form: /theme <name>
  await mockInput.typeText("/theme matrix");
  await s();
  mockInput.pressEnter();
  await s();
  ck("/theme <name> applies directly", currentThemeName() === "matrix");

  await mockInput.typeText("/theme nonsense");
  await s();
  mockInput.pressEnter();
  await s();
  ck("an unknown name reports an error", captureCharFrame().includes("Unknown theme"));
  ck("and does not change the theme", currentThemeName() === "matrix");

  engine.destroy();
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
