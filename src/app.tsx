import { createSignal, onCleanup, createEffect } from "solid-js";
import {
  TextTableRenderable,
  InputRenderable,
  TextRenderable,
  BoxRenderable,
  type TextTableContent,
  type TextTableCellContent,
  parseColor,
  createTextAttributes,
  StyledText,
  createTimeline,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { engine, type TorrentItem } from "./engine.js";
import { interceptKeyPress } from "./keyboard-utils.js";
import { Button } from "./button.js";
import { progressSegments } from "./format.js";
import { logoCells, cometIntensity, cometColour, blend } from "./logo.js";
import { avatarFrame, avatarBrightness } from "./avatar.js";

/**
 * The dino's belly/feet colour - a fixed gold/yellow-tan, not theme- or
 * status-driven, matching the reference image's own markings (2026-08-09).
 * Originally a muted cream (#E5D3A0), bumped warmer and more saturated
 * after it read as muddy against dark theme backgrounds. Lives here rather
 * than in avatar.ts since avatar.ts stays purely about SHAPE and role
 * assignment; actual colour values are app.tsx's job throughout (see the
 * logo's LETTER_PALETTE and the body's running/idle colours below).
 */
const BELLY_COLOUR = "#F2C572";
import { SettingsPanel, isSettingsOpen, setIsSettingsOpen, openSettings } from "./settings-panel.js";
import { DetailPanel, isDetailOpen, setIsDetailOpen } from "./detail-panel.js";
import { overlayKey, anyOverlayOpen } from "./overlay.js";
import { takeNextLink, resolveStateDir } from "./handoff.js";
import { AddPanel, isAddOpen, setIsAddOpen } from "./add-panel.js";
import {
  theme, themeVersion, applyTheme, dimText, THEME_NAMES,
  COMMANDS, matchCommands, type CommandSpec,
} from "./theme.js";

const TABLE_HEADERS = ["SEL", "ID", "Name", "Size", "Progress", "Down", "Up", "Ratio", "Status"];

/**
 * Fixed reserved widths for columns whose text changes shape tick to tick -
 * a speed going "550 KB/s" -> "1.23 MB/s" used to change that column's
 * measured width and shove every column after it sideways. Reserving each
 * column's real maximum keeps it visually still; the actual (usually
 * shorter) value just sits left-aligned inside it. Column index -> width.
 *
 *  - Status: a CLOSED set of exactly 5 strings from torrent-core.ts -
 *    "Failed"/"Paused"/"Metadata..."/"Done"/"Downloading". Longest is 11
 *    chars, no buffer needed - nothing outside this list can ever appear.
 *  - Size/Down/Up: formatBytes()/formatSpeed() in format.ts show 0 decimals
 *    >=100, 1 decimal 10-99, 2 decimals <10, then auto-rolls to the next
 *    unit at 1024 - so the number part is at most 5 chars even at a
 *    rounding edge ("100.0"). "1023 MB/s" (9 chars) is the real ceiling for
 *    any home connection - nothing on today's internet sustains GB/s
 *    torrent traffic, and the format itself would roll to GB/s before a
 *    value could ever display that way. Reserved 1 char above that measured
 *    ceiling each, as a buffer.
 *  - Ratio: ratio.toFixed(2) has no library-enforced ceiling - a long-lived
 *    seeder can genuinely pass 99.99. Reserved up to "9999.99" (7 chars),
 *    generous headroom above any realistic ratio.
 *  - Progress: the bar itself is a hard-coded 12 chars (progressSegments()
 *    in format.ts always sums filled+empty to exactly 10, plus 2 edge
 *    glyphs) and the percentage text is already `padStart(6)` in the code
 *    below - together always exactly 19, on every torrent, always. Without
 *    reserving it here too, the column measured only the 8-char "Progress"
 *    header on an EMPTY table and then jumped to 19 the instant the first
 *    row appeared - the exact same reflow this whole map exists to prevent,
 *    just triggered by row count instead of a changing value.
 */
const FIXED_COLUMN_WIDTH: Partial<Record<number, number>> = {
  3: 8,  // Size:     "1023 TB"
  4: 19, // Progress: bar(12) + " " + percentage.padStart(6)
  5: 10, // Down:     "1023 MB/s"
  6: 10, // Up:       "1023 MB/s"
  7: 7,  // Ratio:    "9999.99"
  8: 11, // Status:   "Downloading" / "Metadata..."
};

/** Most suggestion rows to show at once - the rest scroll. */
const MAX_SUGGESTIONS = 6;

/**
 * TextTableRenderable has NO "headers" option - the header row is simply the
 * first row of content. app.tsx used to pass headers={[...]} as a prop,
 * which fell through to `node.headers = [...]`, setting a property that
 * nothing reads, so the columns were never labelled.
 */
function formatTorrentTableContent(
  torrents: TorrentItem[],
  selectedIndex: number,
  checked: Set<number>,
  containerWidth = 0,
): TextTableContent {
  // Each header takes the colour of the data beneath it, so the header row
  // reads as a legend. An earlier version alternated two accents by column
  // parity, which looked deliberate but encoded nothing - odd-versus-even is
  // not a property of the data.
  const headerColours: string[] = [
    theme.accent,    // SEL      - selection marker
    dimText(),       // ID
    theme.text,      // Name
    theme.info,      // Size
    theme.progress,  // Progress - the bar
    theme.progress,  // Down     - green while moving
    theme.warning,   // Up       - amber while moving
    theme.accent2,   // Ratio
    theme.accent,    // Status
  ];
  // The SEL header carries the count, so "how many am I about to act on?"
  // is answerable without counting ticks down the column.
  const headerRow = TABLE_HEADERS.map((label, column) => [{
    __isChunk: true as const,
    text: column === 0 && checked.size > 0 ? String(checked.size)
      : FIXED_COLUMN_WIDTH[column] ? label.padEnd(FIXED_COLUMN_WIDTH[column]!)
      : label,
    fg: parseColor(headerColours[column] ?? theme.accent),
    attributes: createTextAttributes({ bold: true }),
  }]);

  const rows = torrents.map((t, index) => {
    const isSelected = index === selectedIndex;

    // Finished and broken rows get a background wash, the way a diff marks
    // added and removed lines. Deliberately a FAINT tint of the theme's own
    // success/error rather than the full colour - a saturated row background
    // is exactly what made the old selection highlight swallow the bar.
    // Declared first because every chunk below carries it.
    const rowBg =
      t.status === "Done" ? parseColor(blend(theme.background, theme.success, 0.16))
      : t.status === "Failed" ? parseColor(blend(theme.background, theme.error, 0.18))
      : undefined;

    const plain = (text: string) => ({ __isChunk: true as const, text, bg: rowBg });

    /**
     * SEL is a CHECKBOX, and the cursor is something else.
     *
     * They are genuinely two things. The cursor is where you are - arrows
     * move it, Details opens on it, and it always exists. The tick is what
     * bulk actions operate on, and it starts empty so nothing is armed by
     * accident.
     *
     * The cursor keeps showing through the accent-coloured name (below)
     * rather than a second marker in this column, because two markers in one
     * row is the kind of thing you have to stop and decode.
     */
    const isChecked = checked.has(t.id);
    const marker = [{
      __isChunk: true as const,
      text: isChecked ? "[x]" : "[ ]",
      fg: parseColor(isChecked ? theme.accent : isSelected ? theme.accent2 : theme.muted),
      bg: rowBg,
    }];

    // The progress cell is several chunks so the bar carries its own colours:
    // heavy green edges and green fill, remainder in a faint shade so the
    // centre reads as empty. theme.progress is green in EVERY palette - using
    // theme.success instead left the bar grey in the mono theme.
    const segments = progressSegments(t.progressRatio);
    const barColor = parseColor(theme.progress);
    const emptyColor = parseColor(theme.muted);
    const progressCell = [
      { __isChunk: true as const, text: segments.left, fg: barColor, bg: rowBg },
      { __isChunk: true as const, text: segments.filled, fg: barColor, bg: rowBg },
      { __isChunk: true as const, text: segments.empty, fg: emptyColor, bg: rowBg },
      { __isChunk: true as const, text: segments.right, fg: barColor, bg: rowBg },
      plain(" " + t.progress.padStart(6)),
    ];

    // Give each column a role colour. The table used to be two colours -
    // accent for the header, text for everything else - which read as
    // monochrome no matter which theme was picked.
    const tinted = (text: string, colour: string) =>
      ({ __isChunk: true as const, text, fg: parseColor(colour), bg: rowBg });

    const statusColour =
      t.status === "Failed" ? theme.error
      : t.status === "Done" ? theme.success
      : t.status === "Paused" ? theme.muted
      : theme.accent; // Downloading, Metadata...

    // Idle transfers stay muted so a glance finds the ones actually moving.
    const moving = (speed: string) => speed !== "-" && speed !== "0 B/s";

    return [
      marker,
      [tinted(t.id.toString(), dimText())],
      [tinted(t.name, isSelected ? theme.accent : theme.text)],
      [tinted(t.size, theme.info)],
      progressCell,
      [tinted(t.downSpeed, moving(t.downSpeed) ? theme.progress : dimText())],
      [tinted(t.upSpeed, moving(t.upSpeed) ? theme.warning : dimText())],
      [tinted(t.ratio, t.ratio === "-" ? dimText() : theme.accent2)],
      [tinted(t.status, statusColour)],
    ];
  });

  /**
   * columnWidthMode="content" (below, on the <table>) sizes every column to
   * its own content with no stretching - which is exactly what SEL/ID need,
   * but left every OTHER column tight too, so short names left a blank strip
   * between the table and the backend-counts sidebar. There is no per-column
   * "grow" flag in TextTableRenderable's API (checked: TextTable.d.ts has no
   * such option), so the only lever is the CONTENT itself: pad just the Name
   * header's text with trailing spaces so the library's own content-width
   * measurement treats the Name column as wider - nothing about a real row's
   * name text changes, only the invisible header string gets longer.
   *
   * The target is computed from containerWidth (the scrollbox's real, live
   * layout width - see tableBoxRef in App()) minus every OTHER column's own
   * natural width, not a fixed guess: a fixed pad (tried first) either left a
   * gap on a wider terminal or overflowed the last column on a narrower one.
   * Recomputed on every 1s refresh tick, so a resize corrects itself within a
   * second same as the rest of the table already does.
   */
  const cellWidth = (cell: TextTableCellContent): number =>
    (cell ?? []).reduce((sum, chunk) => sum + chunk.text.length, 0);
  const BORDER_CHARS = TABLE_HEADERS.length + 1; // one column-divider per boundary, outer edges included
  const otherColumnsWidth = TABLE_HEADERS.reduce((sum, _label, column) => {
    if (column === 2) return sum; // Name itself - excluded, it is what absorbs the remainder
    const natural = Math.max(
      cellWidth(headerRow[column]),
      ...rows.map(row => cellWidth(row[column])),
    );
    return sum + natural;
  }, 0);
  const naturalNameWidth = Math.max(
    cellWidth(headerRow[2]),
    ...rows.map(row => cellWidth(row[2])),
  );
  if (containerWidth > 0) {
    const available = containerWidth - 4 - BORDER_CHARS - otherColumnsWidth;
    if (available >= naturalNameWidth) {
      // Room for even the longest current name - fill the gap, nothing to
      // truncate. Unchanged from before.
      headerRow[2] = [{ ...headerRow[2][0], text: headerRow[2][0].text.padEnd(available) }];
    } else if (available >= 4) {
      // Not enough room for at least one real name. Without this, wrapMode=
      // "none" (which keeps every OTHER column honest) would let an
      // oversized Name run straight off the terminal edge, raggedly cut off
      // mid-word ("...Airbender.20") - the exact bug the 40-char server-side
      // truncation used to paper over, just now happening live instead of
      // baked into the data. An ellipsis says the same thing on purpose: cut
      // here, more exists. Only rows that actually overflow get shortened -
      // a short name still shows in full even when a LONGER sibling row
      // doesn't fit. `available - 3` reserves room for "..."; `available>=4`
      // guards against a window so narrow there is no room for even one
      // real character plus the ellipsis.
      for (const row of rows) {
        const cell = row[2][0];
        if (cell.text.length > available) {
          row[2] = [{ ...cell, text: cell.text.slice(0, available - 3) + "..." }];
        }
      }
      headerRow[2] = [{ ...headerRow[2][0], text: headerRow[2][0].text.padEnd(available) }];
    }
    // else: available < 4 - no room even for one character plus "...".
    // Genuinely nothing sensible to show; leave Name at its natural width
    // and let the shared terminal-too-narrow clipping (wrapMode="none")
    // handle it the same as every other column does in that situation.
  }

  return [headerRow, ...rows];
}

export function App() {
  const [torrents, setTorrents] = createSignal<TorrentItem[]>([]);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [suggestions, setSuggestions] = createSignal<CommandSpec[]>([]);
  const [suggestionIndex, setSuggestionIndex] = createSignal(0);
  /**
   * Which torrent has "Remove + Files" armed, if any. Deleting downloaded
   * data is irreversible, so that button needs a second click to fire.
   * Stored as an id rather than a boolean so that changing the selection
   * disarms it - otherwise arming on one torrent and then arrowing to
   * another would delete the wrong one's files on the confirming click.
   */
  const [armedDeleteKey, setArmedDeleteKey] = createSignal<string | null>(null);
  /**
   * Armed state for shutting the daemon down entirely - stops every torrent
   * in every window watching it, not just this one, so it gets the same
   * two-step confirm as Remove + Files. Unlike that one there is no target
   * to key it against: this is a single global action, so a plain boolean
   * is enough. Shared between the button and the /shutdown-daemon command -
   * either can arm it, either can confirm it.
   */
  const [shutdownArmed, setShutdownArmed] = createSignal(false);
  /**
   * Mirrors the DAEMON's own armed flag, not local UI state - it can be true
   * because a DIFFERENT window armed it, so it is read fresh from the engine
   * on the same 1s tick as everything else in updateTorrents(), not toggled
   * optimistically here.
   */
  const [shutdownWhenDoneArmed, setShutdownWhenDoneArmed] = createSignal(false);

  /**
   * Torrents ticked for a bulk action, by ID.
   *
   * Empty by default - opening the app should not arm anything. IDs rather
   * than row indices because indices shift when a torrent is removed.
   */
  const [checked, setChecked] = createSignal<Set<number>>(new Set());
  /** Bumped on every refresh so overlays can follow live progress. */
  const [refreshTick, setRefreshTick] = createSignal(0);
  const [backendCounts, setBackendCounts] =
    createSignal<{ daemonPid: number | null; windowPids: number[] }>({ daemonPid: null, windowPids: [] });
  /**
   * The Backend sidebar's 4 lines, computed once and shared by both the
   * box's own width (sized to whichever line is longest right now) and each
   * individual <text> - a single source so the two can never disagree.
   */
  const backendLines = (): string[] => {
    const { daemonPid, windowPids } = backendCounts();
    const list = torrents();
    const active = list.filter(t => t.status === "Downloading").length;
    const lines = [
      "Backend",
      "Daemon: " + (daemonPid ? "1 (pid " + daemonPid + ")" : "down"),
      // (C) marks THIS window's own pid among the others listed - with
      // several windows open and their pids otherwise indistinguishable,
      // there was no way to tell which one you were actually looking at.
      // Sorted so it leads the list rather than landing wherever presence.ts
      // happened to scan it from the directory - the one pid you actually
      // care about on THIS screen shouldn't require reading past the others
      // first.
      "Windows: " + windowPids.length + (windowPids.length > 0
        ? " (pid " + [...windowPids]
            .sort((a, b) => (a === process.pid ? -1 : b === process.pid ? 1 : 0))
            .map(p => p === process.pid ? p + " (C)" : String(p))
            .join(", ") + ")"
        : ""),
      "Downloading: " + active + "/" + list.length,
    ];
    // Only counted toward the box's width when it will actually be shown
    // (see windowsNoteRef.visible in updateTorrents()) - otherwise the box
    // would stay permanently wider than needed just to leave room for a
    // message nobody is seeing.
    if (windowPids.length >= 3) {
      lines.push((windowPids.length - 1) + " other vit sessions open - close extras?");
    }
    return lines;
  };
  /** Drives the logo colour wave and the avatar's legs. */
  const [animTick, setAnimTick] = createSignal(0);

  const renderer = useRenderer();

  /**
   * Calling process.exit() directly leaves the terminal in the alternate
   * screen buffer with raw mode still on, so the TUI stays painted and old
   * scrollback bleeds through afterwards. renderer.destroy() restores the
   * terminal first.
   */
  const shutdown = (): void => {
    try {
      engine.destroy();
    } catch {
      // Never let engine teardown block terminal restore.
    }
    // Halt the render loop FIRST. destroy() only queues itself when called
    // during a render, so the loop kept painting frames that immediately
    // undid the restore sequences written below - which is why the TUI
    // stayed on screen across three earlier attempts at this.
    try {
      renderer.stop();
    } catch {
      // Continue to teardown regardless.
    }
    try {
      renderer.destroy();
    } catch {
      // Fall through to the explicit escape sequences below.
    }

    // renderer.destroy() defers its cleanup when called during a render
    // (see _destroyPending / prepareDestroyDuringRender / finalizeDestroy),
    // and /quit is dispatched from inside an event handler. Exiting
    // immediately therefore killed the process before the terminal was
    // restored, leaving the TUI painted with shell scrollback behind it.
    // Write the restore sequences ourselves so correctness does not depend
    // on that deferred work completing, then yield a tick before exiting.
    process.stdout.write(
      "\x1b[?1049l" + // leave alternate screen buffer
      "\x1b[?25h" +   // show cursor
      "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l" + // disable mouse reporting
      "\x1b[0m",      // reset attributes
    );
    setTimeout(() => process.exit(0), 30);
  };

  let tableRef: TextTableRenderable | undefined;
  let inputRef: InputRenderable | undefined;
  let errorTextRef: TextRenderable | undefined;
  let suggestBoxRef: BoxRenderable | undefined;
  let suggestTextRef: TextRenderable | undefined;
  let hintTextRef: TextRenderable | undefined;
  let logoTextRef: TextRenderable | undefined;
  let avatarRef: TextRenderable | undefined;
  let rootRef: BoxRenderable | undefined;
  let headerBoxRef: BoxRenderable | undefined;
  let tableBoxRef: BoxRenderable | undefined;
  let promptRef: TextRenderable | undefined;
  let windowsNoteRef: TextRenderable | undefined;
  /** First list index currently painted, for mapping clicks back. */
  let suggestionWindowStart = 0;

  /** Terminal size, however this renderer exposes it. */
  const viewport = (): { width: number; height: number } => ({
    width: (renderer as any).terminalWidth ?? (renderer as any).width ?? 100,
    height: (renderer as any).terminalHeight ?? (renderer as any).height ?? 30,
  });

  /** "block" needs 81 columns plus the frame's padding; below that, shrink. */
  const logoFont = (): "block" | "tiny" =>
    (viewport().width >= 84 ? "block" : "tiny");

  /**
   * Drop the decorative header when the terminal is too short for it.
   *
   * The rows below it are not optional - the table is the app and the input
   * is the only way to type a command - so when everything cannot fit, the
   * logo and the avatar are what goes. Without this the boxes were laid out
   * past the bottom of the screen and painted over each other: at 100x10 the
   * logo glyphs bled through the hint line and the table borders ran through
   * the prompt.
   *
   * 20 rows is what the full header plus a usable table needs: 2 padding,
   * ~6 header, 2 buttons, ~8 table, 1 input, and a row of slack.
   *
   * `visible` is not just skipped painting - opentui maps it to yoga's
   * display:none, so a hidden box stops taking up space too.
   */
  const applyResponsiveLayout = (): void => {
    const { height } = viewport();
    if (headerBoxRef) headerBoxRef.visible = height >= 20;
  };

  /**
   * Paint the logo with a colour wave travelling across it, and step the
   * avatar. Both are redrawn on the animation tick.
   *
   * Animation style ported from codemie-opencode (2026-08-09, see
   * `research/codemie-opencode-src` .../component/logo.tsx): a single band
   * sweeps once left to right, then pauses, rather than the old continuous
   * two-hue cosine wave. Base colour is `theme.text` (plain, legible); the
   * band tints toward `theme.accent` as it passes and everything reverts to
   * plain text once it's gone - a punctuated glint, not an ambient pulse.
   */
  const paintHeader = (): void => {
    applyResponsiveLayout();

    // Nothing below is visible on a short terminal, and the wave is the most
    // expensive thing painted per tick.
    if (headerBoxRef && !headerBoxRef.visible) return;

    if (logoTextRef) {
      const rows = logoCells("vi-torrent", logoFont());
      if (rows.length) {
        const logoWidth = rows[0]?.length ?? 0;
        // codemie's own timing (SWEEP_WIDTH 6, PAUSE_FRAMES 20) is tuned for
        // its 70ms tick; ours ticks at 120ms, so the pause is scaled to land
        // on the same WALL-CLOCK duration (20 * 70 / 120 ~= 12), not the same
        // raw frame count - otherwise the pause would visibly shrink.
        //
        // No separate border ring, no separate line glyph - both read as a
        // disconnected second object. Same cells, same object throughout;
        // only glyph density and colour vary.
        //
        // The edge signal is the font's OWN outline segment (colorIndex 2),
        // not generic neighbour-detection for WHETHER a cell is an edge.
        // Neighbour-detection for THAT question was tried first and broke R
        // and E specifically: thin strokes have a disproportionate edge-to-
        // interior ratio, so a large fraction of the letter went dark and
        // the letterform stopped reading as R/E. The font author already
        // drew a fill/outline distinction per glyph that follows the actual
        // letterform, so using colorIndex for "is this an edge" is edge-
        // detection for free, correctly shaped per letter.
        //
        // What DOES use neighbour-detection now is WHICH SIDE an edge cell
        // is on, per the "TORRENT" reference render (2026-08-09): a real
        // lit 3D extrusion has a bright top face, a mid-bright left face,
        // and a dark right/bottom face - not one uniform tint. Background
        // directly above -> bright highlight; to the right or below -> dark
        // shadow; to the left -> mid-tone. This is safe against the R/E
        // failure mode because it only classifies cells the font ALREADY
        // marked as edges - it never decides edge-or-not itself.
        //
        // Letters cycle through the theme's own role colours (accent,
        // accent2, progress, info, success, warning, error) instead of one
        // flat accent, echoing the reference render's rainbow letters while
        // staying theme-aware rather than a hardcoded palette. The FILL
        // stays neutral (theme.text) at rest and only takes on its letter's
        // colour as the sweep passes - the edges' directional tint is
        // already always-on static shading (unaffected by the sweep, as
        // before), so only the fill's resting state was a real behaviour
        // question; the edges were never neutral to begin with.
        //
        // The sweep is a comet now, not a fixed-width tinted band (reference
        // render, 2026-08-09): `cometIntensity` gives an exponentially
        // decaying tail behind the beam instead of a hard 6-column cutoff,
        // and `cometColour` shifts HUE along that tail (white-hot core ->
        // letter colour -> theme.accent2 as a cool secondary hue -> back to
        // resting) rather than blending toward one flat colour. Each fill
        // cell samples the comet at two slightly different columns
        // (`column` and `column + 0.5`) and renders as "▀" with the earlier
        // sample as its top half and the later sample as its bottom half -
        // real per-half colour instead of a single flat tint, the same
        // half-block mechanism as the avatar's shading, applied here to
        // smooth the gradient's column-to-column step rather than to model
        // a light source (there's no "up" or "down" to a sideways-moving
        // comet - see logo.ts's cometIntensity/cometColour doc comments).
        // Outside the comet's reach the glyph is untouched.
        const LETTER_PALETTE = [
          theme.accent, theme.accent2, theme.progress,
          theme.info, theme.success, theme.warning, theme.error,
        ];
        const isBackground = (r: number, c: number) => (rows[r]?.[c]?.char ?? " ") === " ";
        // Long enough for the tail to fully clear (see cometIntensity's
        // TAIL_DECAY=5 - negligible past ~20 columns behind the beam)
        // before the Timeline's pause/loop begins, same role the old fixed
        // sweepWidth played in the overshoot below.
        const tailClearance = 24;
        const beamPos = sweepBeam.pos * (logoWidth + tailClearance);
        const chunks: object[] = [];
        for (const [lineIndex, row] of rows.entries()) {
          for (const [column, cell] of row.entries()) {
            if (cell.char === " ") {
              chunks.push({ __isChunk: true, text: " " });
              continue;
            }
            const letterColour = LETTER_PALETTE[cell.letterIndex % LETTER_PALETTE.length];
            if (cell.colorIndex === 2) {
              let edgeChar: string;
              let mix: number;
              if (isBackground(lineIndex - 1, column)) {
                edgeChar = "▓"; mix = 0.85; // top face - brightest, facing the light
              } else if (isBackground(lineIndex, column + 1) || isBackground(lineIndex + 1, column)) {
                edgeChar = "░"; mix = 0.25; // right/bottom face - shadow
              } else if (isBackground(lineIndex, column - 1)) {
                edgeChar = "▒"; mix = 0.55; // left face - mid-tone
              } else {
                edgeChar = "░"; mix = 0.5; // interior outline segment, no open side
              }
              const edgeColour = blend(theme.background, letterColour, mix);
              chunks.push({ __isChunk: true, text: edgeChar, fg: parseColor(edgeColour) });
              continue;
            }
            const topT = cometIntensity(column, beamPos);
            const bottomT = cometIntensity(column + 0.5, beamPos);
            if (topT > 0 || bottomT > 0) {
              const topColour = cometColour(topT, letterColour, theme.accent2, theme.text);
              const bottomColour = cometColour(bottomT, letterColour, theme.accent2, theme.text);
              chunks.push({ __isChunk: true, text: "▀", fg: parseColor(topColour), bg: parseColor(bottomColour) });
            } else {
              chunks.push({ __isChunk: true, text: cell.char, fg: parseColor(theme.text) });
            }
          }
          if (lineIndex < rows.length - 1) {
            chunks.push({ __isChunk: true, text: "\n" });
          }
        }
        // TextRenderable.content takes a StyledText, not a bare chunk array.
        logoTextRef.content = new StyledText(chunks as any);
      }
    }

    if (avatarRef) {
      // Read the ENGINE, not the torrents() signal. paintHeader() is called
      // from an effect that also calls updateTorrents(), which sets that
      // signal - reading it here made the effect depend on what it writes,
      // and it re-entered until the stack blew.
      const running = engine.getTorrents()
        .some(t => t.status === "Downloading" || t.status === "Background");
      const tick = animTick();
      const frame = avatarFrame("dino", running, tick);
      const brightness = avatarBrightness("dino", running, tick);
      const bodyColour = running ? theme.progress : theme.muted;
      // Half-block rendering: every filled cell is "▀" (upper half block),
      // its fg the TOP half's colour, its bg the BOTTOM half's colour - two
      // independently coloured samples per cell instead of one, so shading
      // is continuous colour blend, not a hand-placed or quantised
      // character ramp (see avatar.ts's avatarBrightness doc comment).
      //
      // Three roles, three colour rules, matching the reference image
      // (2026-08-09): the BODY follows app state (greeen downloading, grey
      // idle) same as before, but the belly/feet and the eye are the dino's
      // own fixed markings, not status indicators - a real animal's colours
      // don't change with what it's doing. The eye is flat white-over-black
      // with no lambert shading at all: it reads as shiny, not matte skin.
      const chunks: object[] = [];
      for (let row = 0; row < frame.length; row++) {
        const line = frame[row];
        for (let col = 0; col < line.length; col++) {
          const char = line[col];
          if (char === " ") {
            chunks.push({ __isChunk: true, text: " " });
            continue;
          }
          const cell = brightness[row]?.[col];
          if (cell?.role === "eye") {
            chunks.push({ __isChunk: true, text: char, fg: parseColor("#ffffff"), bg: parseColor("#1a1a1a") });
            continue;
          }
          const roleColour = cell?.role === "belly" ? BELLY_COLOUR : bodyColour;
          const top = blend(theme.background, roleColour, cell?.top ?? 1);
          const bottom = blend(theme.background, roleColour, cell?.bottom ?? 1);
          chunks.push({ __isChunk: true, text: char, fg: parseColor(top), bg: parseColor(bottom) });
        }
        if (row < frame.length - 1) chunks.push({ __isChunk: true, text: "\n" });
      }
      avatarRef.content = new StyledText(chunks as any);
    }

    // Ask for a frame. On its own this is not enough for a smooth animation -
    // see requestLive() below - but it covers the case where the renderer is
    // painting on demand.
    try {
      (renderer as any).requestRender?.();
    } catch {
      // Cosmetic only - never let a repaint request break the app.
    }
  };

  const suggestionsOpen = () => suggestions().length > 0;

  /**
   * Route a key to whichever overlay is open.
   * Returns undefined when none is, so callers can fall back to their own
   * behaviour (or decline the key entirely).
   */
  const modalKey = (name: string): boolean | undefined => {
    // Overlay-based panels register themselves with a priority, so there is
    // nothing to list here.
    return overlayKey(name);
  };
  const modalOpen = () => anyOverlayOpen();

  const refreshSuggestions = () => {
    const value = inputRef?.value ?? "";
    const matches = matchCommands(value);
    setSuggestions(matches);
    if (suggestionIndex() >= matches.length) setSuggestionIndex(0);
  };

  // Accept the highlighted suggestion into the input (does not run it).
  const acceptSuggestion = () => {
    const list = suggestions();
    const pick = list[suggestionIndex()];
    if (!pick || !inputRef) return;
    inputRef.value = pick.args ? pick.name + " " : pick.name;
    inputRef.requestRender();
    refreshSuggestions();
  };

  /**
   * Run the command the user clicked in the suggestion list. One suggestion
   * per line, so the line offset within the text block IS the index.
   */
  const chooseSuggestionAt = (screenRow: number): void => {
    if (!suggestTextRef) return;
    // Offset by the scroll window, or clicks would hit the wrong command
    // whenever the list is longer than MAX_SUGGESTIONS.
    const index = screenRow - suggestTextRef.screenY + suggestionWindowStart;
    const list = suggestions();
    if (index < 0 || index >= list.length) return;
    setSuggestionIndex(index);
    submitSuggestion();
  };

  /**
   * Commit the highlighted suggestion: commands that need an argument are
   * completed into the input, the rest run immediately. Shared by Enter and
   * by clicking, so both behave identically.
   */
  const submitSuggestion = (): void => {
    const pick = suggestions()[suggestionIndex()];
    if (!pick || !inputRef) return;
    if (pick.args?.startsWith("<")) {
      acceptSuggestion();
      return;
    }
    setSuggestions([]);
    handleCommand(pick.name);
    inputRef.value = "";
    inputRef.requestRender();
    refreshSuggestions();
  };

  const navigate = (direction: "up" | "down") => {

    // While the inline suggestion list is open, arrows move through it
    // rather than the torrent table.
    if (suggestionsOpen()) {
      const max = suggestions().length - 1;
      setSuggestionIndex(prev =>
        direction === "up" ? Math.max(0, prev - 1) : Math.min(max, prev + 1),
      );
      return;
    }

    // Moving the cursor disarms a pending delete confirmation. It only
    // matters when nothing is ticked, since the cursor row is then the
    // target - but disarming unconditionally is the safe direction to be
    // wrong in. Shutdown has no target to drift onto, but leaving it armed
    // (and its button lit red) after the user has moved on to something
    // else reads as stuck, not careful.
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    const max = Math.max(0, engine.getTorrents().length - 1);
    setSelectedIndex(prev =>
      direction === "up" ? Math.max(0, prev - 1) : Math.min(max, prev + 1),
    );
    updateTorrents();
  };

  /**
   * Map a clicked screen row to a torrent.
   *
   * The table draws a rule between every row, so a row's line sits at
   * tableTop + 3 + index*2 (top border, header, separator, then rows).
   * Dividing by two is deliberately forgiving: clicking the rule directly
   * under a row selects that row rather than doing nothing.
   */
  const selectRowAt = (screenRow: number): void => {
    if (!tableRef) return;
    const offset = screenRow - tableRef.screenY - 3;
    if (offset < 0) return; // header or the border above it
    const index = Math.floor(offset / 2);
    const torrent = engine.getTorrents()[index];
    if (!torrent) return;
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    setSelectedIndex(index);
    // A click both moves the cursor and ticks the row: "click to select" is
    // what a checkbox column promises. Arrow keys move the cursor WITHOUT
    // ticking, so there is still a way to look around without arming
    // anything.
    toggleChecked(torrent.id);
  };

  /** Tick or untick one torrent. */
  const toggleChecked = (id: number): void => {
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    setChecked(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    updateTorrents();
  };

  const checkAll = (): void => {
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    setChecked(new Set(engine.getTorrents().map(t => t.id)));
    updateTorrents();
  };

  const checkNone = (): void => {
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    setChecked(new Set());
    updateTorrents();
  };

  const updateTorrents = () => {
    const rawTorrents = engine.getTorrents();
    setRefreshTick(n => n + 1);
    setShutdownWhenDoneArmed(engine.isShutdownWhenDoneArmed());
    const counts = engine.backendCounts();
    setBackendCounts(counts);
    // A nudge for a case that is easy to end up in without noticing - a few
    // stray clicked links or double-opened shortcuts, each spawning its own
    // window against the same daemon. All of them are legitimate (see
    // presence.ts), so this never blocks anything, it just surfaces a count
    // that is otherwise invisible unless someone thinks to check the
    // sidebar. 3+ chosen so opening one deliberate second window (the
    // common, intentional case) never triggers it.
    if (windowsNoteRef) windowsNoteRef.visible = counts.windowPids.length >= 3;

    if (selectedIndex() >= rawTorrents.length && rawTorrents.length > 0) {
      setSelectedIndex(rawTorrents.length - 1);
    } else if (rawTorrents.length === 0) {
      setSelectedIndex(0);
    }

    // Drop ticks for torrents that no longer exist. IDs are never reused, so
    // a stale tick cannot silently reattach to a different torrent - but it
    // would keep the header count wrong and leave a delete armed against
    // something that has already gone.
    const liveIds = new Set(rawTorrents.map(t => t.id));
    const stale = [...checked()].filter(id => !liveIds.has(id));
    if (stale.length > 0) {
      setChecked(previous => new Set([...previous].filter(id => liveIds.has(id))));
      setArmedDeleteKey(null);
    }

    if (tableRef) {
      tableRef.content = formatTorrentTableContent(rawTorrents, selectedIndex(), checked(), tableBoxRef?.width ?? 0);
    }
    setTorrents(rawTorrents);
  };

  // Re-attach to whatever was running when the app last closed. Everything
  // comes back PAUSED by design: closing the app should never silently
  // resume downloads behind the user's back - they choose when to continue.
  // Apply the saved theme before the tree is built, so the first paint is
  // already in the right colours rather than flashing the default.
  applyTheme(engine.getSettings().theme);

  const persistTheme = (name: string): void => {
    try {
      engine.applySettings({ ...engine.getSettings(), theme: name });
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  engine.restore();
  /**
   * Which torrents came back from the last session.
   *
   * Kept as infoHashes rather than a count so the "Reattached N" notice can
   * retire itself: it is only true while those specific torrents are still
   * listed AND still paused. A count captured here can only ever go stale -
   * it kept claiming a reattached torrent was waiting after it had been
   * resumed or removed, on a table that was by then empty.
   */
  const restoredHashes = engine.getRestoredHashes();

  const handoffDir = resolveStateDir();

  /**
   * Pick up a link the operating system handed us.
   *
   * Set by clicking a magnet link in a browser or opening a .torrent file:
   * that launches a second vi-torrent, which leaves the link in the inbox and
   * exits rather than fighting this window for the session (see handoff.ts).
   *
   * Only while no dialog is open, and only one link per tick. Opening the Add
   * dialog on top of a dialog the user is already in would throw away what
   * they were doing, and the links wait perfectly well - each one opens as
   * soon as the previous is dealt with.
   */
  const openHandedLink = (): void => {
    if (anyOverlayOpen()) return;
    const link = takeNextLink(handoffDir);
    if (!link) return;
    try {
      if (link.startsWith("magnet:")) engine.previewMagnet(link);
      else engine.previewFile(link);
      setIsAddOpen(true);
      updateTorrents();
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const timer = setInterval(() => {
    openHandedLink();
    updateTorrents();
  }, 1000);

  /**
   * Drives the logo sweep's beam position - opentui's own tweening engine
   * (see research/docs/opentui-11-animation-timeline.md), not a hand-rolled
   * tick counter. `createTimeline` auto-registers with the engine that
   * `@opentui/solid`'s `render()` already attached to this renderer at
   * startup, so no manual attach/detach is needed here.
   *
   * `sweepBeam.pos` is mutated in place by the tween (0 -> 1 over SWEEP_MS,
   * eased), then holds at 1 for the remainder of the timeline's own
   * `duration` before looping - that hold IS the pause, no separate pause
   * branch needed; see intensityAtBeam()'s doc comment in logo.ts for why.
   * `pos` is read fresh every paintHeader() call, same "mutable object, read
   * at render time" pattern as the `theme` object.
   */
  const sweepBeam = { pos: 0 };
  const SWEEP_MS = 9000;
  const SWEEP_PAUSE_MS = 1440; // unchanged from the old pauseFrames=12 @ 120ms/tick
  const sweepTimeline = createTimeline({ duration: SWEEP_MS + SWEEP_PAUSE_MS, loop: true });
  sweepTimeline.add(sweepBeam, { pos: 1, duration: SWEEP_MS, ease: "inOutSine" });

  // Faster than the 1s data refresh: this only redraws the header, and the
  // wave needs to move smoothly.
  const animation = setInterval(() => {
    setAnimTick(n => n + 1);
    paintHeader();
  }, 120);

  // Put the renderer in LIVE mode. By default it paints on demand, so the
  // wave advanced in memory while the terminal only caught up when something
  // else forced a frame - the logo looked frozen. This is the API opentui
  // provides for exactly this case; dropLive() releases it on teardown.
  try {
    (renderer as any).requestLive?.();
  } catch {
    // If live mode is unavailable the app still works, just less smoothly.
  }

  // Re-pick the logo font when the terminal is resized.
  try {
    (renderer as any).on?.("resize", paintHeader);
  } catch {
    // Resize handling is cosmetic only.
  }

  onCleanup(() => {
    clearInterval(timer);
    clearInterval(animation);
    sweepTimeline.pause();
    try {
      (renderer as any).dropLive?.();
    } catch {
      // Teardown must not throw.
    }
    engine.destroy();
  });

  // Surface async engine failures (bad torrent data, tracker errors) as an
  // inline message rather than letting them escape as unhandled rejections.
  engine.onError(message => setErrorMsg(message));

  createEffect(() => {
    // Keep focus on the input even while an overlay is open - the overlays
    // have no focusable widgets of their own and rely on the input's key
    // intercepts to receive keys at all.
    if (inputRef) inputRef.focus();
  });

  // Mount unconditionally + mutate .visible/.content imperatively rather than
  // conditionally rendering, so the input instance (and its key intercepts)
  // survives across show/hide.
  createEffect(() => {
    // Read the LIVE rows, not a startup snapshot - see restoredHashes.
    const rows = torrents();
    if (!hintTextRef) return;

    // Only the restored torrents that are still here and still waiting. The
    // old code printed the count captured at launch forever, so the header
    // went on claiming "Reattached 1 torrent ... click Resume" after that
    // torrent had been resumed, or removed, or the table emptied entirely.
    const waiting = rows.filter(
      t => restoredHashes.has(t.infoHash) && t.status === "Paused").length;

    hintTextRef.content = waiting > 0
      ? `Reattached ${waiting} torrent${waiting === 1 ? "" : "s"} from your last session · paused, click Resume to continue`
      : "BitTorrent client for the terminal";
  });

  /**
   * Repaint every colour that JSX set once at mount.
   *
   * JSX props are not reactive in this project (see button.tsx), so a theme
   * change would otherwise only show up on the parts that are already redrawn
   * imperatively - leaving the borders and the logo on the old palette.
   */
  createEffect(() => {
    themeVersion();
    // theme.background was already used throughout as blend() maths, but
    // never actually applied to the terminal's real backdrop - the renderer
    // defaults backgroundColor to "transparent" and nothing here ever set
    // it, so the app always showed the terminal's OWN background (black,
    // for most people) regardless of theme. codemie-opencode sets this on
    // its root box the same way (research/codemie-opencode-src/.../app.tsx);
    // this mirrors that, through the theme-repaint effect rather than a
    // JSX prop, per the "JSX props are not reactive here" note above.
    if (rootRef) rootRef.backgroundColor = theme.background;
    if (tableBoxRef) tableBoxRef.borderColor = theme.border;
    if (promptRef) promptRef.fg = theme.accent;
    if (errorTextRef) errorTextRef.fg = theme.error;
    if (hintTextRef) hintTextRef.fg = dimText();
    if (suggestBoxRef) suggestBoxRef.borderColor = theme.accent;
    // The suggestion list carries its own per-chunk colours, so no blanket
    // fg here - setting one would flatten them back to a single tone.
    refreshSuggestions();
    paintHeader();
    // Table cells carry their own selection colours, so rebuild them too.
    updateTorrents();
  });

  createEffect(() => {
    const msg = errorMsg();
    if (errorTextRef) {
      errorTextRef.content = msg;
      errorTextRef.visible = !!msg;
    }
  });

  createEffect(() => {
    const list = suggestions();
    const active = suggestionIndex();
    if (suggestBoxRef) suggestBoxRef.visible = list.length > 0;
    if (suggestTextRef && list.length > 0) {
      // Cap the visible rows. The full list is tall enough to push the input
      // off the bottom of a short terminal, which reads as the app breaking.
      // The window follows the highlighted entry so it is always on screen.
      const start = list.length <= MAX_SUGGESTIONS
        ? 0
        : Math.max(0, Math.min(active - Math.floor(MAX_SUGGESTIONS / 2),
            list.length - MAX_SUGGESTIONS));
      const shown = list.slice(start, start + MAX_SUGGESTIONS);

      // Built as chunks, not one string: command, argument and description
      // are different KINDS of thing and want different colours, and the
      // highlighted row needs to stand out by more than a "❯" glyph.
      const chunks: object[] = [];
      const push = (text: string, fg: string, bold = false) => chunks.push({
        __isChunk: true,
        text,
        fg: parseColor(fg),
        ...(bold ? { attributes: createTextAttributes({ bold: true }) } : {}),
      });

      shown.forEach((c, i) => {
        const selected = start + i === active;
        const args = c.args ? " " + c.args : "";
        const pad = Math.max(1, 24 - (c.name.length + args.length));

        push(selected ? "❯ " : "  ", selected ? theme.accent : theme.muted);
        push(c.name, selected ? theme.accent : theme.text, selected);
        if (args) push(args, theme.info);
        push(" ".repeat(pad), theme.muted);
        push(c.description, selected ? theme.text : dimText());
        if (i < shown.length - 1) chunks.push({ __isChunk: true, text: "\n" });
      });

      const hidden = list.length - shown.length;
      if (hidden > 0) {
        chunks.push({ __isChunk: true, text: "\n" });
        push("  + " + hidden + " more", theme.accent2);
        push("            arrow keys to scroll", dimText());
      }

      suggestTextRef.content = new StyledText(chunks as any);
      // Clicking maps a screen line to a list index, so it has to know where
      // the window starts.
      suggestionWindowStart = start;
    }
  });


  const handleCommand = (cmd: string) => {
    setErrorMsg("");
    const parts = cmd.trim().split(" ");
    const command = parts[0];
    const arg = parts.slice(1).join(" ");

    try {
      if (command === "/add-magnet") {
        if (!arg) throw new Error("Missing magnet URI");
        // Inspect first: the dialog decides whether it is added at all.
        engine.previewMagnet(arg);
        setIsAddOpen(true);
        updateTorrents();
      } else if (command === "/add-file") {
        if (!arg) throw new Error("Missing .torrent file path");
        engine.previewFile(arg);
        setIsAddOpen(true);
        updateTorrents();
      } else {
        /**
         * An explicit id overrides the selection entirely; otherwise the
         * command does exactly what the matching button does - ticked rows,
         * or the cursor row when nothing is ticked.
         */
        const runOnTargets = (fn: (id: number) => void) => {
          if (arg) {
            const id = parseInt(arg, 10);
            if (!Number.isFinite(id)) throw new Error("Not a torrent id: " + arg);
            fn(id);
            updateTorrents();
            return;
          }
          act(fn);
        };

        if (command === "/pause") {
          runOnTargets(id => engine.pause(id));
        } else if (command === "/resume") {
          runOnTargets(id => engine.resume(id));
        } else if (command === "/remove") {
          runOnTargets(id => engine.remove(id));
        } else if (command === "/select-all") {
          checkAll();
        } else if (command === "/select-none") {
          checkNone();
        } else if (command === "/theme") {
          if (!arg) {
            // Themes live in Settings - one place for preferences, one
            // implementation. This just lands the cursor on that row.
            openSettings("theme");
          } else if (applyTheme(arg)) {
            persistTheme(arg);
          } else {
            throw new Error("Unknown theme: " + arg + " (try " + THEME_NAMES.join(", ") + ")");
          }
        } else if (command === "/details") {
          if (!selectedLive()) throw new Error("No torrent selected");
          setIsDetailOpen(true);
        } else if (command === "/settings") {
          setIsSettingsOpen(true);
        } else if (command === "/shutdown-daemon") {
          shutdownDaemon();
        } else if (command === "/shutdown-when-done") {
          toggleShutdownWhenDone();
        } else if (command === "/quit" || command === "/exit") {
          shutdown();
        } else {
          throw new Error("Unknown command: " + command);
        }
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  // Two different readers on purpose. The buttons' greyed-out state has to
  // read the torrents() SIGNAL to be reactive, but that signal is only
  // refreshed on a 1s timer -- acting on it can target a torrent list up to
  // a second out of date. Actions therefore resolve against the engine,
  // which is the source of truth (same rule getTargetId() already follows).
  const selectedForDisplay = () => torrents()[selectedIndex()];
  const nothingSelected = () => !selectedForDisplay() && checked().size === 0;
  const selectedLive = () => engine.getTorrents()[selectedIndex()];

  /**
   * What an action applies to.
   *
   * Ticked rows if there are any, otherwise the row under the cursor. That
   * fallback is not a convenience - without it, pausing one torrent would
   * mean ticking it first, which is worse than the single-selection
   * behaviour this replaced.
   *
   * Resolved against the ENGINE, not the rendered rows: the table repaints on
   * a 1s tick and can be a second out of date. Ticks are stored as torrent
   * IDs rather than row indices for the same reason - indices shift the
   * moment anything is removed, so a stale index would act on its neighbour.
   */
  const targetIds = (): number[] => {
    const live = engine.getTorrents();
    const ticked = live.filter(t => checked().has(t.id)).map(t => t.id);
    if (ticked.length > 0) return ticked;
    const cursor = selectedLive();
    return cursor ? [cursor.id] : [];
  };

  /** Stable signature of the current targets, so arming cannot drift onto others. */
  const targetKey = () => targetIds().join(",");

  /** The target torrents themselves - what the BG dialog describes. */
  const targetTorrents = (): TorrentItem[] => {
    refreshTick(); // repaint the dialog on the app's 1s tick
    const ids = new Set(targetIds());
    return engine.getTorrents().filter(t => ids.has(t.id));
  };

  const deleteArmed = () => {
    const key = targetKey();
    return key.length > 0 && armedDeleteKey() === key;
  };

  /**
   * Run a torrent action against every target, surfacing failures inline.
   *
   * Keeps going after a failure rather than stopping at the first: pausing
   * eight torrents should not abandon seven because one of them was mid
   * handover. The first error is reported, with a count if there were more.
   */
  const act = (fn: (id: number) => void) => {
    setArmedDeleteKey(null);
    setShutdownArmed(false);
    setErrorMsg("");
    const ids = targetIds();
    if (ids.length === 0) {
      setErrorMsg("No torrent selected");
      return;
    }
    const failures: string[] = [];
    for (const id of ids) {
      try {
        fn(id);
      } catch (e: any) {
        failures.push(e.message);
      }
    }
    updateTorrents();
    if (failures.length === 1) setErrorMsg(failures[0]);
    else if (failures.length > 1) {
      setErrorMsg(`${failures[0]}  (and ${failures.length - 1} more)`);
    }
  };

  /**
   * Two clicks, armed against the exact set being deleted.
   *
   * Keyed to the target signature rather than a single id: with several
   * ticked, arming on one torrent and then deleting a different set is the
   * failure that actually matters here, because this is the one action that
   * cannot be undone. Changing the selection between clicks disarms it.
   */
  const removeWithFiles = () => {
    const ids = targetIds();
    if (ids.length === 0) {
      setErrorMsg("No torrent selected");
      return;
    }
    if (!deleteArmed()) {
      setArmedDeleteKey(targetKey());
      setErrorMsg("");
      return;
    }
    act(id => engine.remove(id, true));
  };

  /**
   * Two triggers (button, /shutdown-daemon), one armed state. First call
   * arms and warns; second call - from either trigger - actually shuts the
   * daemon down. Stops every window watching it, not just this one, so it
   * gets the same weight as removeWithFiles despite having no target of its
   * own to key against.
   */
  /**
   * A true shutdown, not a half one: the daemon and this window go together,
   * the way a laptop's screen and CPU power off together rather than leaving
   * a dead desktop lit with nothing underneath it. Awaits the daemon's real
   * confirmation before tearing this window down - not a guessed delay -
   * so the request has genuinely landed before there is no window left to
   * report a failure to.
   */
  const shutdownDaemon = async () => {
    if (!shutdownArmed()) {
      setShutdownArmed(true);
      setErrorMsg("Stops ALL downloads in every window, and closes this window too. Click/type again to confirm.");
      return;
    }
    setShutdownArmed(false);
    setErrorMsg("");
    await engine.shutdownDaemon();
    shutdown();
  };

  /**
   * Freely reversible toggle, not an arm-then-confirm action like the one
   * above: arming this does not fire anything by itself, only schedules a
   * future check the daemon runs on its own - so typing/clicking it again
   * to cancel carries none of the risk shutdownDaemon() does.
   */
  const toggleShutdownWhenDone = () => {
    const next = !shutdownWhenDoneArmed();
    engine.armShutdownWhenDone(next);
    setShutdownWhenDoneArmed(next);
    setErrorMsg(next
      ? "Will stop the daemon once every torrent finishes DOWNLOADING - seeding is not waited for."
      : "");
  };

  return (
    <box
      ref={(el: BoxRenderable) => (rootRef = el)}
      width="100%" height="100%" flexDirection="column" padding={1}
    >
      <box
        ref={(el: BoxRenderable) => (headerBoxRef = el)}
        flexDirection="row"
        marginBottom={1}
        flexShrink={0}
      >
        <text
          ref={(el: TextRenderable) => (avatarRef = el)}
          marginRight={2}
          flexShrink={0}
        />
      <box flexDirection="column">
        {/*
          The logo is drawn as plain text rather than <ascii_font> so each
          column can carry its own colour - see src/logo.ts for why the
          renderable's own colour array cannot do a travelling wave.
        */}
        <text ref={(el: TextRenderable) => (logoTextRef = el)} />
        <text ref={(el: TextRenderable) => (hintTextRef = el)} fg={theme.muted} />
      </box>
      </box>

      {/*
        wrap, not nowrap: with nine buttons a narrow terminal simply cut the
        row off at the right edge, so Details/Settings/Quit vanished with no
        way to reach them. Wrapping spends a row instead of hiding actions.
      */}
      <box flexDirection="row" flexWrap="wrap" marginBottom={1} flexShrink={0}>
        {/*
          Selection first, then the actions that consume it - the same order
          the Add dialog uses. "None" is the way out of an armed bulk delete
          as well as a way to clear ticks.
        */}
        <Button
          label={() => "All"}
          disabled={() => torrents().length === 0}
          onPress={checkAll}
        />
        <Button
          label={() => "None"}
          disabled={() => checked().size === 0}
          onPress={checkNone}
        />
        <Button
          label={() => "Pause"}
          disabled={nothingSelected}
          onPress={() => act(id => engine.pause(id))}
        />
        <Button
          label={() => "Resume"}
          disabled={nothingSelected}
          onPress={() => act(id => engine.resume(id))}
        />
        <Button
          label={() => "Remove"}
          disabled={nothingSelected}
          onPress={() => act(id => engine.remove(id))}
        />
        <Button
          label={() => {
            if (!deleteArmed()) return "Remove + Files";
            // Say the number out loud. With several ticked, "Click again to
            // delete" gives no clue how much is about to go.
            const n = targetIds().length;
            return n === 1 ? "Click again to delete" : `Click again: delete ${n} + files`;
          }}
          disabled={nothingSelected}
          tone={() => (deleteArmed() ? "danger" : "normal")}
          onPress={removeWithFiles}
        />
        <Button
          label={() => "Details"}
          disabled={nothingSelected}
          onPress={() => setIsDetailOpen(true)}
        />
        <Button label={() => "Settings"} onPress={() => setIsSettingsOpen(true)} />
        {/*
          Stops every window watching this daemon, not just this one - so it
          gets the same two-click confirm as Remove + Files, and its own
          colour warns before the second click rather than after.
        */}
        <Button
          label={() => (shutdownArmed() ? "Click again: shutdown daemon" : "Shutdown daemon")}
          tone={() => (shutdownArmed() ? "danger" : "normal")}
          onPress={shutdownDaemon}
        />
        {/*
          A toggle, not an armed confirm - clicking it schedules a future
          check rather than doing anything immediately, so it needs no
          second click and no danger tone. Survives this window closing: the
          watch itself runs in the daemon, this button just reflects its
          current state, read fresh every 1s tick like the torrent list.
        */}
        <Button
          label={() => (shutdownWhenDoneArmed() ? "Cancel shutdown-when-done" : "Shutdown when done")}
          onPress={toggleShutdownWhenDone}
        />
        <Button label={() => "Quit"} onPress={shutdown} />
      </box>

      {/*
        A scrollbox, not a plain box: the table's height is its row count, and
        a box does not clip - on a short terminal the rows were painted past
        the bottom of their own frame and straight through the prompt below.
        The scrollbox clips to whatever height is left over and scrolls with
        the wheel, so the app stays usable at any terminal size instead of
        having a minimum one.
      */}
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={3}>
        <scrollbox
          ref={(el: BoxRenderable) => {
            tableBoxRef = el;
            // A ScrollBox is focusable by default, so clicking a torrent row
            // took focus off the command input and everything typed afterwards
            // went nowhere. Nothing here needs keyboard focus - the arrow keys
            // already drive row selection - so refuse it.
            (el as any).focusable = false;
          }}
          flexGrow={1}
          flexShrink={1}
          border={true}
          borderStyle="rounded"
          borderColor={theme.border}
          paddingLeft={1}
          paddingRight={1}
          scrollY={true}
          scrollX={false}
        >
          <table
            ref={(el: TextTableRenderable) => {
              tableRef = el;
              // Paint immediately - the refresh timer would otherwise leave
              // the table blank (no headers either) for the first second.
              updateTorrents();
            }}
            columnWidthMode="content"
            // wrapMode="none" is what actually keeps every column at its
            // real width no matter how narrow the terminal gets - read
            // TextTable's own compiled source (computeColumnWidths /
            // resolveLayoutWidthConstraint in @opentui/core) to confirm:
            // "content" mode alone only skips EXPANDING past natural width,
            // it still SHRINKS below it whenever content is wider than the
            // container; wrapMode="none" is the one value that makes
            // resolveLayoutWidthConstraint return no constraint at all. A
            // too-narrow window now clips the row cleanly at its own edge
            // instead of corrupting text into "Downlo"/"ading" - no
            // horizontal scroll to reveal the rest, though: tried making the
            // scrollbox's content wider than its viewport (matching
            // TextTable.width explicitly, scrollX, contentOptions) and none
            // of it stuck - the content wrapper's width silently snapped
            // back to the viewport's on every attempt, verified by direct
            // property read-back, not a timing guess. Genuine limitation in
            // this version of the ScrollBox, not something worth patching
            // node_modules for.
            wrapMode="none"
            onMouseDown={(event: { y: number }) => selectRowAt(event.y)}
          />
        </scrollbox>

        {/*
          What's actually running in the backend: the daemon's own pid (or
          "down" if this window cannot reach one), the pid of every open TUI
          window - this one included - and how many of the current torrents
          are actively downloading. Purely a read of state that already
          exists (daemon-status.json's pid, presence.ts's window markers, the
          same torrent list the table renders) - nothing new is tracked.
        */}
        <box
          // A fixed guess (28, then 36 once Windows started showing real
          // pids) cost the table real width it usually didn't need - one
          // torrent's window pid is short, but the box still reserved room
          // for a hypothetical multi-window case every single render. Sized
          // from its own real current lines instead, same principle as the
          // Name column's fill logic: usually narrow, grows only when there
          // truly are several windows with longer pid lists to show.
          width={() => Math.max(...backendLines().map(l => l.length)) + 4}
          flexShrink={0}
          flexDirection="column"
          border={true}
          borderStyle="rounded"
          borderColor={theme.border}
          paddingLeft={1}
          paddingRight={1}
          marginLeft={1}
        >
          <text fg={theme.muted}>{() => backendLines()[0]}</text>
          <text>{() => backendLines()[1]}</text>
          <text>{() => backendLines()[2]}</text>
          <text>{() => backendLines()[3]}</text>
          {/*
            3+ windows is always legitimate (see presence.ts) so this never
            blocks anything - it is purely a nudge for the easy-to-miss case
            of stray windows piling up unnoticed. Hidden by default and
            toggled in updateTorrents(), the same pattern errorTextRef/
            suggestBoxRef already use elsewhere in this file.
          */}
          <text
            ref={(el: TextRenderable) => {
              windowsNoteRef = el;
              el.visible = false;
            }}
            fg={theme.warning}
          >
            {() => backendLines()[4] ?? ""}
          </text>
        </box>
      </box>

      <text
        ref={(el: TextRenderable) => {
          errorTextRef = el;
          el.visible = false;
        }}
        fg={theme.error}
        marginBottom={1}
        flexShrink={0}
      />

      <box
        ref={(el: BoxRenderable) => {
          suggestBoxRef = el;
          el.visible = false;
        }}
        flexDirection="column"
        // The suggestion list must never be the thing that gets squeezed:
        // the table above it grows to fill the window, so without this the
        // two shrank in proportion and half the commands went missing.
        flexShrink={0}
        border={true}
        borderStyle="rounded"
        borderColor={theme.accent}
        paddingLeft={1}
        paddingRight={1}
      >
        <text
          ref={(el: TextRenderable) => (suggestTextRef = el)}
          fg={theme.text}
          onMouseDown={(event: { y: number }) => chooseSuggestionAt(event.y)}
        />
      </box>

      {/*
        The table scrollbox is the ONLY element allowed to absorb a size
        change - it can scroll, everything else just disappears. Hence
        flexShrink={0} on this row, the error line and the suggestion list.
      */}
      <box flexDirection="row" height={1} flexShrink={0}>
        <text ref={(el: TextRenderable) => (promptRef = el)} fg={theme.accent} marginRight={1}>{"❯"}</text>
        <input
          ref={(el: InputRenderable) => {
            inputRef = el;
            el.on("input", refreshSuggestions);
            el.on("enter", () => {
              // Enter completes a partially-typed command rather than
              // submitting it -- but ONLY when completion would actually
              // change something. Without this exact-match check, typing a
              // whole argument-less command like "/quit" left its own
              // suggestion open, so Enter re-completed it forever and the
              // command could never run (it only worked with a trailing
              // space, which empties the suggestion list).
              if (suggestionsOpen()) {
                const typed = el.value.trim().toLowerCase();
                const exact = COMMANDS.find(c => c.name.toLowerCase() === typed);
                // "<arg>" is required, "[arg]" is optional (those commands
                // fall back to the selected torrent), so only a required
                // argument should force completion instead of running.
                const needsArgument = !!exact?.args?.startsWith("<");
                if (!exact || needsArgument) {
                  acceptSuggestion();
                  return;
                }
                setSuggestions([]);
              }
              if (el.value) {
                handleCommand(el.value);
                el.value = "";
                el.requestRender();
                refreshSuggestions();
              }
            });
            // A focused Input consumes every keystroke in its own
            // handleKeyPress before global handlers see it, so these must be
            // intercepted on the instance. See keyboard-utils.ts.
            interceptKeyPress(el, [
              { name: "c", ctrl: true, handler: shutdown },
              // While the settings panel is open it owns the arrows, enter
              // and escape. left/right decline when it is closed so the
              // input keeps its own cursor movement.
              { name: "up", handler: () => (modalKey("up") ?? navigate("up")) },
              { name: "down", handler: () => (modalKey("down") ?? navigate("down")) },
              { name: "left", handler: () => modalKey("left") ?? false },
              { name: "right", handler: () => modalKey("right") ?? false },
              { name: "return", handler: () => modalKey("return") ?? false },
              { name: "tab", handler: acceptSuggestion },
              {
                name: "escape",
                handler: () => {
                  const handled = modalKey("escape");
                  if (handled !== undefined) return handled;
                  setSuggestions([]);
                  setSuggestionIndex(0);
                  setArmedDeleteKey(null);
                  setShutdownArmed(false);
                },
              },
              // Last resort while a modal owns the screen: hand it the key by
              // name (so panel shortcuts like space work without every one
              // needing its own entry above), and swallow whatever it does
              // not use so stray typing cannot land in the input behind it.
              // Declines - falls through - whenever no modal is open.
              {
                name: "*",
                handler: (key) => {
                  if (!modalOpen()) return false;
                  modalKey(key.name);
                  return true;
                },
              },
            ]);
            el.focus();
          }}
          width="100%"
          placeholder="Type / for commands..."
        />
      </box>

      <SettingsPanel
        initial={() => engine.getSettings()}
        onApply={next => engine.applySettings(next)}
      />

      <AddPanel
        preview={() => engine.getPreview()}
        onAdd={skipped => {
          try {
            engine.confirmPreview(skipped);
            updateTorrents();
            return null;
          } catch (e: any) {
            return e.message;
          }
        }}
        onCancel={() => {
          try {
            engine.cancelPreview();
            updateTorrents();
          } catch { /* cancelling must always close the dialog */ }
        }}
        tick={refreshTick}
      />

      <DetailPanel
        torrent={selectedForDisplay}
        files={() => {
          const t = selectedForDisplay();
          return t ? engine.getFiles(t.id) : [];
        }}
        peers={() => {
          const t = selectedForDisplay();
          return t ? engine.getPeers(t.id) : [];
        }}
        onToggleFile={fileIndex => {
          const t = selectedForDisplay();
          if (!t) return "No torrent selected";
          try {
            engine.toggleFile(t.id, fileIndex);
            return null;
          } catch (e: any) {
            return e.message;
          }
        }}
        onSetAllFiles={(wanted, keep) => {
          const t = selectedForDisplay();
          if (!t) return "No torrent selected";
          try {
            const changed = engine.setAllFiles(t.id, wanted, keep);
            updateTorrents();
            return changed;
          } catch (e: any) {
            return e.message;
          }
        }}
        tick={refreshTick}
      />
    </box>
  );
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      table: any;
      ascii_font: any;
      input: any;
      select: any;
    }
  }
}
