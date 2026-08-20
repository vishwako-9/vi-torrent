import { createSignal, createEffect } from "solid-js";
import { theme, dimText } from "./theme.js";
import { Overlay } from "./overlay.js";
import { Button } from "./button.js";
import type { PreviewInfo } from "./engine.js";

export const [isAddOpen, setIsAddOpen] = createSignal(false);

export interface AddPanelProps {
  preview: () => PreviewInfo | null;
  /** Confirm with the indices of files to SKIP. Returns an error, or null. */
  onAdd: (skipped: number[]) => string | null;
  onCancel: () => void;
  /** Bumped by the app each refresh so the swarm counts stay live. */
  tick: () => number;
}

/**
 * "Add torrent" dialog.
 *
 * Nothing is downloaded until the user says Add: the torrent sits paused
 * while its metadata arrives, and unticked files are deselected BEFORE it
 * starts, so skipped data is never fetched rather than fetched and discarded.
 *
 * Seeders and leechers come from the tracker announce, not the connected peer
 * count - that is the difference between "dead torrent" and "slow start".
 */
export function AddPanel(props: AddPanelProps) {
  const [cursor, setCursor] = createSignal(0);
  const [skipped, setSkipped] = createSignal<Set<number>>(new Set());
  const [notice, setNotice] = createSignal("");


  createEffect(() => {
    if (isAddOpen()) {
      setCursor(0);
      setSkipped(new Set());
      setNotice("");
    }
  });

  const title = (): string => {
    const info = props.preview();
    return info ? "Add torrent:  " + info.name + "   " + info.size : "Add torrent";
  };

  /** Swarm line. Seeders decide whether this will ever finish. */
  const subtitle = () => {
    props.tick();
    const info = props.preview();
    if (!info) return { text: "", colour: dimText() };
    if (!info.ready) {
      return {
        text: "Fetching metadata from peers...   peers " + info.peers +
          (info.waitedMs > 20000 ? "   (no metadata yet - the torrent may be dead)" : ""),
        colour: info.waitedMs > 20000 ? theme.warning : dimText(),
      };
    }
    const seeds = info.seeds === null ? "?" : String(info.seeds);
    const leech = info.leechers === null ? "?" : String(info.leechers);
    const dead = info.seeds === 0 && info.peers === 0 && info.waitedMs > 15000;
    return {
      text: "seeders " + seeds + "   leechers " + leech + "   connected " + info.peers +
        (dead ? "   - no seeders found, this torrent looks dead" : ""),
      colour: dead ? theme.error : info.seeds && info.seeds > 0 ? theme.success : dimText(),
    };
  };

  const body = (): string => {
    props.tick();
    const info = props.preview();
    const skip = skipped();
    const at = cursor();
    if (!info?.ready) return "\n  The file list appears once metadata arrives.";

    const lines = ["FILES (" + (info.files.length - skip.size) + " of " + info.files.length + " selected)"];
    info.files.forEach((file, index) => {
      const marker = index === at ? "❯ " : "  ";
      const tick = skip.has(file.index) ? "[ ]" : "[x]";
      // The NAME, not a slice of the middle of the path.
      const name = (file.name || file.path).slice(0, 52).padEnd(52);
      lines.push(marker + tick + " " + name + " " + file.size.padStart(10));
    });
    return lines.join("\n");
  };


  /** One header line ("FILES (n of m selected)") precedes the list. */
  const clickFile = (row: number): void => {
    const index = row - 1;
    const files = props.preview()?.files ?? [];
    if (index < 0 || index >= files.length) return;
    setCursor(index);
    setWanted(files[index].index, undefined);
  };

  const NOTHING_SELECTED = "At least one file must stay selected";

  /**
   * Record a new skip set and say whether it is addable.
   *
   * Emptying the list is ALLOWED here, and only refused by Add. "None, then
   * tick the three I want" is the reason the None button exists, and a rule
   * that blocked the last untick would have made it useless - it would have
   * left one arbitrary file selected for the user to notice later. The engine
   * enforces the same rule at confirm time, so nothing can slip past.
   */
  const applySkip = (next: Set<number>): void => {
    const total = props.preview()?.files.length ?? 0;
    setSkipped(next);
    setNotice(total > 0 && next.size >= total ? NOTHING_SELECTED : "");
  };

  /** wanted=undefined flips it. */
  const setWanted = (fileIndex: number, wanted: boolean | undefined): void => {
    const next = new Set(skipped());
    const shouldSkip = wanted === undefined ? !next.has(fileIndex) : !wanted;
    if (shouldSkip) next.add(fileIndex);
    else next.delete(fileIndex);
    applySkip(next);
  };

  const selectAll = (): void => applySkip(new Set());

  const selectNone = (): void =>
    applySkip(new Set((props.preview()?.files ?? []).map(file => file.index)));

  const confirm = (): void => {
    const error = props.onAdd([...skipped()]);
    if (error) setNotice(error);
    else setIsAddOpen(false);
  };

  const cancel = (): void => {
    props.onCancel();
    setIsAddOpen(false);
  };

  const handleKey = (name: string): boolean => {
    const info = props.preview();
    const files = info?.files ?? [];

    if (name === "up") { setCursor(c => Math.max(0, c - 1)); return true; }
    if (name === "down") { setCursor(c => Math.min(Math.max(0, files.length - 1), c + 1)); return true; }

    if (name === "space" || name === " " || name === "left" || name === "right") {
      const file = files[cursor()];
      // right always includes, left always skips, space flips - explicit beats
      // "toggle" when you are working down a list deciding.
      if (file) setWanted(file.index, name === "right" ? true : name === "left" ? false : undefined);
      return true;
    }

    if (name === "return" || name === "enter") { confirm(); return true; }
    if (name === "escape") { cancel(); return true; }
    return true; // swallow everything else while open
  };

  return (
    <Overlay
      open={isAddOpen}
      priority={30}
      onKey={handleKey}
      title={title}
      subtitle={subtitle}
      hint={() => "click a file, or up/down then space · right include · left skip"}
      body={body}
      notice={notice}
      onBodyClick={clickFile}
      top="10%"
      zIndex={300}
    >
      <box flexDirection="row" marginTop={1}>
        {/* Selection first, then the actions that end the dialog. */}
        <Button label={() => "All"} onPress={selectAll} />
        <Button label={() => "None"} onPress={selectNone} />
        <Button label={() => "Add"} onPress={confirm} />
        <Button label={() => "Cancel"} onPress={cancel} />
      </box>
    </Overlay>
  );
}

