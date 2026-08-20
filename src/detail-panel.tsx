import { createSignal } from "solid-js";
import { Overlay } from "./overlay.js";
import { Button } from "./button.js";
import { progressBar } from "./format.js";
import type { FileItem, PeerItem, TorrentItem } from "./engine.js";

export const [isDetailOpen, setIsDetailOpen] = createSignal(false);

export interface DetailPanelProps {
  torrent: () => TorrentItem | undefined;
  files: () => FileItem[];
  peers: () => PeerItem[];
  /** Include or skip a file; returns an error message if it refused. */
  onToggleFile: (fileIndex: number) => string | null;
  /**
   * Include or skip every file at once. `keep` is the one left selected when
   * skipping, since a torrent with nothing wanted just sits there. Returns an
   * error, or how many files actually changed.
   */
  onSetAllFiles: (wanted: boolean, keep: number) => string | number;
  /** Bumped by the app once a second so the panel follows live progress. */
  tick: () => number;
}

/** Most peers to list - the panel does not scroll, and a busy torrent has dozens. */
const MAX_PEERS = 8;

/**
 * Per-torrent detail: which files it contains and who it is talking to.
 *
 * The frame, chrome and key routing live in Overlay; this supplies content.
 */
export function DetailPanel(props: DetailPanelProps) {
  const [cursor, setCursor] = createSignal(0);
  const [notice, setNotice] = createSignal("");

  const title = () => {
    const t = props.torrent();
    return t ? t.name + "   " + t.size + "   " + t.status : "No torrent selected";
  };

  const body = () => {
    props.tick(); // repaint on the app's refresh tick, for live progress
    const files = props.files();
    const peers = props.peers();
    const at = cursor();
    const lines: string[] = [];

    // A "Failed" row said nothing about WHY. The reason was recorded by the
    // engine's per-torrent error listener and then never shown anywhere, so
    // the only way to find out was to read the code. Put it first: it is the
    // one thing worth knowing about a failed torrent.
    const failure = props.torrent()?.error;
    if (failure) {
      lines.push("FAILED");
      lines.push("  " + failure);
      lines.push("");
    }

    lines.push("FILES (" + files.length + ")");
    if (files.length === 0) {
      lines.push("  (none yet - metadata may still be loading, or this torrent");
      lines.push("   is running in the background downloader)");
    }
    for (const [index, file] of files.entries()) {
      const marker = index === at ? "❯ " : "  ";
      const tick = file.wanted ? "[x]" : "[ ]";
      // The name, not a tail slice of the path - long release paths were
      // being cut mid-word and read as noise.
      const name = (file.name || file.path).slice(0, 46).padEnd(46);
      lines.push(marker + tick + " " + name + " " + file.size.padStart(9) + "  " +
        progressBar(file.progressRatio, 8) + " " + file.progress.padStart(6));
    }

    lines.push("");
    lines.push("PEERS (" + peers.length + ")");
    if (peers.length === 0) lines.push("  (none connected)");
    for (const peer of peers.slice(0, MAX_PEERS)) {
      // kind is padded to 14: "utpOutgoing" is 11 and overflowed a 10-wide
      // column, running straight into the "down" label.
      lines.push("  " + peer.address.padEnd(24) + peer.kind.slice(0, 13).padEnd(14) +
        ("down " + peer.downSpeed).padEnd(18) + "up " + peer.upSpeed);
    }
    if (peers.length > MAX_PEERS) lines.push("  + " + (peers.length - MAX_PEERS) + " more");

    return lines.join("\n");
  };

  /** The engine only offers a toggle, so decide whether to call it. */
  const setWanted = (file: FileItem, want: boolean | undefined): void => {
    const toggle = want === undefined ? true : want !== file.wanted;
    if (toggle) setNotice(props.onToggleFile(file.index) ?? "");
  };

  /**
   * Include or skip everything.
   *
   * Skipping keeps the file under the cursor rather than an arbitrary one -
   * it is the row marked with ❯, so the survivor is visible on screen before
   * the button is pressed.
   */
  const setAll = (wanted: boolean): void => {
    const files = props.files();
    const at = cursor();
    const keep = files[at]?.index ?? 0;
    const result = props.onSetAllFiles(wanted, keep);
    if (typeof result === "string") { setNotice(result); return; }
    if (result === 0) { setNotice("Nothing to change"); return; }
    setNotice(wanted
      ? "All " + files.length + " files included"
      : "Skipped all but " + (files[at]?.name || files[at]?.path || "one file"));
  };

  /** One header line ("FILES (n)") precedes the list. */
  const clickBody = (row: number): void => {
    const files = props.files();
    const index = row - 1;
    if (index < 0 || index >= files.length) return;
    setCursor(index);
    setWanted(files[index], undefined);
  };

  const handleKey = (name: string): boolean => {
    const files = props.files();
    if (name === "up") { setCursor(c => Math.max(0, c - 1)); return true; }
    if (name === "down") { setCursor(c => Math.min(Math.max(0, files.length - 1), c + 1)); return true; }
    // Terminals report the space bar as either "space" or a literal " ".
    if (name === "space" || name === " " || name === "left" || name === "right") {
      const file = files[cursor()];
      // left skips, right includes, space flips - same as the Add dialog.
      if (file) setWanted(file, name === "right" ? true : name === "left" ? false : undefined);
      return true;
    }
    if (name === "escape") { setIsDetailOpen(false); return true; }
    return true; // swallow everything else while open
  };

  return (
    <Overlay
      open={isDetailOpen}
      priority={20}
      onKey={handleKey}
      title={title}
      hint={() => "click a file, or up/down then space · right include · left skip"}
      body={body}
      notice={notice}
      onBodyClick={clickBody}
      top="6%"
      left="5%"
      width="90%"
    >
      <box flexDirection="row" marginTop={1}>
        <Button label={() => "All"} onPress={() => setAll(true)} />
        <Button label={() => "None"} onPress={() => setAll(false)} />
        <Button label={() => "Close"} onPress={() => setIsDetailOpen(false)} />
      </box>
    </Overlay>
  );
}
