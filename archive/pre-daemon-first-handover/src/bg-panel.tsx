import { createSignal, createEffect, untrack } from "solid-js";
import { Overlay } from "./overlay.js";
import { Button } from "./button.js";
import { theme } from "./theme.js";
import type { TorrentItem } from "./engine.js";

/**
 * The Background dialog: decide, then Save.
 *
 * The BG box used to act the instant it was clicked, which made a heavyweight
 * operation - releasing a torrent from this process and handing it to another
 * - indistinguishable from a stray click. Clicking it twice quickly used to
 * lose the row entirely.
 *
 * Here the checkbox only changes what is on screen. Nothing happens until
 * Save, and Cancel leaves the torrent exactly as it was.
 *
 * NOT to be confused with the original design, which set a flag and did the
 * handover at exit: that made ticking BG look like it did nothing at all, and
 * was reported as the checkbox being broken. Save still applies immediately -
 * only the DECISION is deferred, not the effect.
 */
const [isBgOpen, setIsBgOpen] = createSignal(false);
export { isBgOpen, setIsBgOpen };

export interface BgPanelProps {
  /**
   * The torrents the dialog is about - ticked rows, or the cursor row when
   * nothing is ticked. Empty when there is nothing to act on.
   */
  targets: () => TorrentItem[];
  /** Apply the choice to every target. Returns an error message, or null. */
  onSave: (background: boolean) => string | null;
}

export function BgPanel(props: BgPanelProps) {
  /** What the checkbox shows - NOT what the engine is doing. */
  const [checked, setChecked] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  /**
   * Sync the checkbox from the torrent ONLY as the dialog opens.
   *
   * The obvious version - `if (isBgOpen()) setChecked(...)` - reads
   * props.targets(), which reads the refresh signal the app bumps every
   * second. The effect therefore re-ran on every refresh and reset the
   * checkbox to the engine's value, silently undoing the user's tick between
   * keystrokes. Only the OPEN transition may write here, and the read is
   * untracked so the refresh cannot trigger it at all.
   */
  let wasOpen = false;
  createEffect(() => {
    const open = isBgOpen();
    untrack(() => {
      if (open && !wasOpen) {
        setChecked(allBackground());
        setNotice("");
      }
      wasOpen = open;
    });
  });

  const count = () => props.targets().length;
  const inBackground = () => props.targets().filter(t => t.background).length;
  const allBackground = () => count() > 0 && inBackground() === count();

  /**
   * A selection where some are in the background and some are not.
   *
   * Saving is always meaningful here, whichever way the box is left: the
   * point of the dialog is to make the whole selection agree. Without this,
   * a mixed selection opened unticked would count as "unchanged" and Save
   * would quietly do nothing.
   */
  const mixed = () => inBackground() > 0 && inBackground() < count();

  const dirty = () => mixed() || checked() !== allBackground();

  const close = () => {
    setIsBgOpen(false);
    setNotice("");
  };

  const save = () => {
    if (count() === 0) {
      setNotice("No torrent selected");
      return;
    }
    // Saving with nothing changed is not an error, it just closes - the
    // alternative is an "error" for pressing Save on an unchanged dialog.
    if (!dirty()) {
      close();
      return;
    }
    const error = props.onSave(checked());
    if (error) {
      setNotice(error);
      return;
    }
    close();
  };

  const handleKey = (key: string): boolean => {
    if (!isBgOpen()) return false;
    switch (key) {
      // Terminals report the space bar as either "space" or a literal " " -
      // the same pair the Add and Details panels accept.
      case "space":
      case " ":
      case "left":
      case "right":
      case "up":
      case "down":
        setChecked(v => !v);
        return true;
      case "return":
        save();
        return true;
      case "escape":
        close();
        return true;
      default:
        return true; // swallow stray typing while the dialog owns the screen
    }
  };

  const body = () => {
    const n = count();
    if (n === 0) return "No torrent selected.";
    const box = checked() ? "[x]" : "[ ]";
    const these = n === 1 ? "this torrent" : `these ${n} torrents`;
    const lines = [
      "  " + box + "  Download in the background",
      "",
      checked()
        ? `  A detached process takes ${these} over and keeps`
        : `  This process keeps ${these}, and they stop when you`,
      checked()
        ? "  downloading after you close vitorrent."
        : "  close vitorrent.",
    ];
    // Say what the selection currently is when it disagrees with itself -
    // otherwise a single checkbox is standing in for two different states.
    if (mixed()) {
      lines.push("");
      lines.push(`  Right now ${inBackground()} of ${n} are in the background.`);
      lines.push("  Saving makes them all the same.");
    }
    if (dirty()) {
      lines.push("");
      lines.push(checked()
        ? `  On Save: ${n === 1 ? "handed" : "all handed"} to the background downloader.`
        : `  On Save: ${n === 1 ? "taken" : "all taken"} back into this window.`);
    }
    return lines.join("\n");
  };

  return (
    <Overlay
      open={isBgOpen}
      priority={28}
      onKey={handleKey}
      title={() => {
        const list = props.targets();
        if (list.length === 0) return "Background · no torrent selected";
        if (list.length === 1) return "Background · " + list[0].name;
        return `Background · ${list.length} torrents`;
      }}
      hint={() => "space toggles · enter saves · esc cancels · or click below"}
      body={body}
      notice={notice}
      noticeColour={() => theme.error}
      onBodyClick={row => { if (row === 0) setChecked(v => !v); }}
      top="22%"
      left="18%"
      width="64%"
      zIndex={230}
    >
      <box flexDirection="row" marginTop={1}>
        <Button label={() => "Save"} onPress={save} />
        <Button label={() => "Cancel"} onPress={close} />
      </box>
    </Overlay>
  );
}
