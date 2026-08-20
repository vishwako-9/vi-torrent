import { addTorrentNow, checks, fixtureTorrent, platformOptions, settle } from "./_isolate.js";
// The torrent table's column headers.
import { createTestRenderer } from "@opentui/core/testing";
import { render, extend } from "@opentui/solid";
import { TextTableRenderable, ASCIIFontRenderable, InputRenderable, SelectRenderable } from "@opentui/core";
import fs from "fs";
import os from "os";
import path from "path";
import WebTorrent from "webtorrent";
import { App } from "../src/app.js";
import { engine } from "../src/engine.js";
import { theme } from "../src/theme.js";
extend({ table: TextTableRenderable, ascii_font: ASCIIFontRenderable, input: InputRenderable, select: SelectRenderable });

const UBUNTU = await fixtureTorrent();
const HEADERS = ["SEL", "ID", "Name", "Size", "Progress", "Down", "Up", "Ratio", "Status"];

const m = async () => {
  const { renderer, captureCharFrame, captureSpans, waitForVisualIdle } =
    await createTestRenderer({ width: 140, height: 32 });
  await render(() => <App />, renderer);
  const s = () => settle(waitForVisualIdle, 200);
  await s();
  const { ck, done } = checks();

  const frame0 = captureCharFrame();
  ck("headers painted before any torrent is added", HEADERS.every(h => frame0.includes(h)));

  await addTorrentNow(engine, UBUNTU);
  await new Promise(r => setTimeout(r, 1400));
  await s();

  const frame1 = captureCharFrame();
  ck("headers still painted with a torrent loaded", HEADERS.every(h => frame1.includes(h)));
  ck("torrent row painted", frame1.includes("sample"));

  // The header row must not be mistaken for a torrent row: the selection
  // highlight belongs on the real row, and the header must stay above it.
  const lines = frame1.split("\n");
  const headerY = lines.findIndex(l => l.includes("Status"));
  const rowY = lines.findIndex(l => l.includes("sample"));
  ck("header row sits above the data row", headerY >= 0 && rowY > headerY);

  // --- the progress bar's own colours ---
  // A SECOND torrent is needed: row 0 is selected, and on the selected row
  // the bar deliberately uses the high-contrast selection foreground rather
  // than green. Build one offline so this needs no network.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vi-torrent-bar-"));
  const payload = path.join(tmpRoot, "second.bin");
  fs.writeFileSync(payload, Buffer.alloc(64 * 1024, 7));
  const builder = new WebTorrent({ dht: false, tracker: false, lsd: false, ...platformOptions() } as any);
  builder.on("error", () => {});
  const built: any = await new Promise(res =>
    builder.seed(payload, { announce: [] } as any, (t: any) => res(t)));
  const secondTorrent = path.join(tmpRoot, "second.torrent");
  fs.writeFileSync(secondTorrent, built.torrentFile);
  await new Promise(r => builder.destroy(() => r(null)));

  await addTorrentNow(engine, secondTorrent);
  await new Promise(r => setTimeout(r, 1400));
  await s();
  ck("a second, unselected row exists", engine.getTorrents().length === 2);

  const frame2 = captureCharFrame();
  // Scoped to the table rows onward (from the header row down), not the
  // whole screen: the header's avatar sprite ALSO shades with "░" (running
  // torrents colour it theme.progress - the same green), so an unscoped
  // scan would pick up the dino's shading and mistake it for the bar's own
  // colour. Landed 2026-08-09 when the avatar gained shading; before that
  // the avatar never emitted "░" so this collision didn't exist.
  const tableHeaderY = frame2.split("\n").findIndex(l => l.includes("Status"));

  // Collect EVERY colour a glyph is drawn in, from the table down. Returning
  // just the first match would pick up the selected row, whose bar
  // deliberately is not green - the same mistake the "❯" probe made in
  // test-themes.
  const coloursOf = (glyph: string): string[] => {
    const found = new Set<string>();
    const spanLines = captureSpans().lines;
    for (let i = tableHeaderY; i < spanLines.length; i++) {
      for (const span of spanLines[i]?.spans ?? []) {
        if (span.text.includes(glyph)) {
          const c = span.fg as any;
          found.add([c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(","));
        }
      }
    }
    return [...found];
  };
  ck("the bar has thick edges", frame2.includes("▐") && frame2.includes("▌"));
  ck("the empty portion uses a light shade", frame2.includes("░"));

  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].join(",");
  const green = rgb(theme.progress);
  const edges = coloursOf("▐");

  // EVERY bar is green now, including the selected row's - the row is no
  // longer highlighted, so nothing can swallow it.
  ck("the bar is green (" + edges.join(" / ") + " expected " + green + ")",
    edges.length === 1 && edges[0] === green);
  // NOTE: no assertion on the filled "█" here - both torrents sit at 0% with
  // no network, so there is no fill to inspect, and "█" would match the ASCII
  // logo instead. The edge and the fill share one colour, so checking the
  // edge covers both; the segments themselves are asserted in test-settings.
  ck("the empty portion is a different, fainter colour",
    !coloursOf("░").includes(green));

  // --- selection is a marker column, not a row highlight ---
  //
  // SEL is a CHECKBOX now, not the old single radio: several torrents can be
  // ticked and acted on at once. Nothing is ticked until the user says so,
  // so a freshly painted table shows only empty boxes - which is the check
  // that matters, because a default tick would arm bulk actions on launch.
  ck("every row shows an empty checkbox", frame2.includes("[ ]"));
  ck("nothing is ticked on a fresh table", !frame2.includes("[x]"));
  ck("the checkbox column is painted, not blank",
    (frame2.match(/\[ \]/g) ?? []).length >= 1);
  ck("the cursor row is still distinguishable by its name colour",
    coloursOf("sample").includes(rgb(theme.accent)));

  // Each header must carry the colour of its own column's data - that is what
  // makes the header row a legend rather than decoration.
  const headerLine = captureSpans().lines.find(l =>
    l.spans.some(s => s.text.includes("Status")));
  const headerColour = (label: string): string | null => {
    for (const s of headerLine?.spans ?? []) {
      if (s.text.includes(label)) {
        const c = s.fg as any;
        return [c.r, c.g, c.b].map((v: number) => Math.round(v <= 1 ? v * 255 : v)).join(",");
      }
    }
    return null;
  };
  ck("the Size header matches the colour its values use",
    headerColour("Size") === rgb(theme.info));
  ck("the Down header matches the speed colour",
    headerColour("Down") === rgb(theme.progress));
  ck("the Up header matches the upload colour",
    headerColour("Up") === rgb(theme.warning));
  ck("headers are not all one colour",
    new Set(["Size", "Down", "Up", "Name"].map(headerColour)).size > 2);

  // --- ratio ---
  ck("a Ratio column is present", frame2.includes("Ratio"));
  ck("a torrent that has shared nothing shows a dash, not 0.00",
    engine.getTorrents().every(t => t.ratio === "-"));

  engine.destroy();
  await new Promise(r => setTimeout(r, 400));
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  done();
};
m().catch(e => { console.error("ERR:", e); process.exit(1); });
