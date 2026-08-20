import { checks } from "./_isolate.js";
// Progress and completion must be measured against the files the user KEPT.
import { selectedProgress } from "../src/format.js";

const { ck, done } = checks();

/** A file as WebTorrent exposes it, reduced to what the calculation reads. */
const file = (length: number, downloaded: number, isDone = false) =>
  ({ length, downloaded, done: isDone });

// --- the cases where we must defer to WebTorrent ---

// Before metadata arrives there is no file list at all. This is the "loading"
// state: the row shows whatever WebTorrent says, which is 0%.
ck("no files yet (still loading) -> null, caller falls back",
  selectedProgress(undefined, new Set([0])) === null);
ck("empty file list -> null",
  selectedProgress([], new Set([0])) === null);

// Nothing skipped means WebTorrent's own numbers are already correct, and
// recomputing them would be a chance to disagree with it for no reason.
ck("nothing skipped -> null, use WebTorrent's numbers",
  selectedProgress([file(100, 50), file(100, 0)], new Set()) === null);

// --- the bug this exists to fix ---

// Two equal files, one skipped, the kept one fully downloaded. WebTorrent
// would report 50% and never done; we must report 100% and done.
{
  const r = selectedProgress([file(100, 100, true), file(100, 0, false)], new Set([1]));
  ck("kept file complete -> 100% (WebTorrent would say 50%)", r?.progress === 1);
  ck("kept file complete -> done, despite the skipped file being unfinished",
    r?.done === true);
}

// Partway through, the denominator is the kept bytes only.
{
  const r = selectedProgress([file(200, 50), file(800, 0)], new Set([1]));
  ck("progress is measured over kept bytes only (50/200 = 25%)",
    r?.progress === 0.25);
  ck("not done while the kept file is unfinished", r?.done === false);
}

// Several kept files: all must finish, not just one.
{
  const r = selectedProgress(
    [file(100, 100, true), file(100, 40, false), file(100, 0, false)], new Set([2]));
  ck("one of two kept files done -> not done", r?.done === false);
  ck("progress spans every kept file (140/200 = 70%)", r?.progress === 0.7);
}

// --- re-selecting a file later, from the Details panel ---

// Unticking a skip puts those bytes back in the denominator, so a torrent
// that read as complete correctly drops back to incomplete.
{
  const files = [file(100, 100, true), file(100, 0, false)];
  const before = selectedProgress(files, new Set([1]));
  const after = selectedProgress(files, new Set());
  ck("was complete with the file skipped", before?.progress === 1 && before?.done === true);
  ck("re-selecting it hands back to WebTorrent, which reports the real state",
    after === null);
}

// --- edges that must not produce NaN or >100% ---

// Both the Add dialog and toggleFile refuse to leave nothing selected, so this
// should be unreachable - but dividing by zero would put NaN in the bar.
ck("every file skipped -> null, never NaN",
  selectedProgress([file(100, 0), file(100, 0)], new Set([0, 1])) === null);

// Zero-length files are legal in a torrent and would divide by zero.
{
  const r = selectedProgress([file(0, 0, true), file(100, 0)], new Set([1]));
  ck("only a zero-length file kept -> 0%, not NaN",
    r?.progress === 0 && !Number.isNaN(r?.progress));
  ck("...and it still counts as done", r?.done === true);
}

// A torrent can report slightly more downloaded than its length after a
// re-verify; the bar must not overflow its own width.
{
  const r = selectedProgress([file(100, 120, true), file(50, 0)], new Set([1]));
  ck("over-download is clamped to 100%", r?.progress === 1);
}

done();
