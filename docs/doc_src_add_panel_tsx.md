# Component Spec: `src/add-panel.tsx`

**File Path:** [src/add-panel.tsx](../src/add-panel.tsx)
**Role:** The "Add torrent" dialog. Inspect a torrent, choose its files, then accept or reject it.

---

## 1. Functional Specification

1. **Opened by** `/add-magnet <uri>` or `/add-file <path>`. Neither command adds anything on its own; both start a preview and open this dialog.
2. **Title**: torrent name and total size, or `"Add torrent"` before metadata arrives.
3. **Subtitle, the swarm line**, which is the reason to look before adding:
   - Before metadata: `Fetching metadata from peers...   peers N`, turning amber past 20s.
   - After: `seeders N   leechers N   connected N`, green when there are seeders.
   - `seeds === 0 && peers === 0` after 15s prints **"no seeders found, this torrent looks dead"** in the error colour.
   - Seeders/leechers come from the **tracker announce**, not `numPeers`. That distinction is what separates a dead torrent from a slow start.
4. **File list**: every file with a checkbox and size, all selected initially. Shows the file **name**, not a tail slice of the path. Long release paths were being cut mid-word.
5. **Choosing files**:
   - Click a row, or `up`/`down` to move.
   - `right` includes, `left` skips, `space` flips. Explicit beats toggle-only when working down a list deciding.
   - It refuses to leave nothing selected.
6. **Add / Cancel**: clickable buttons (the shared `Button` chip), plus `enter` to add and `escape` to cancel.
7. **Nothing downloads while you decide.** The torrent is added **paused** and held out of `getTorrents()` and the session index. Cancelling destroys it with `destroyStore` and removes the folder.
8. **Skipped files are deselected before the torrent starts**, so their data is never fetched, as opposed to fetched and later ignored, which is what unticking in the Details panel afterwards does.

## 2. Structure

The frame, chrome and key routing come from [`Overlay`](doc_src_overlay_tsx.md) at priority `30`, the highest, since the dialog is a decision in progress. This file supplies `title`, `subtitle`, `body`, `notice`, the key handler, and the two buttons as children.

## 3. Tested by

`tests/test-addpanel.tsx`: the dialog opens instead of adding, metadata loads, files list, clicking a row toggles it, `left`/`right`/`space` behave as specified, the Add button commits with the skip applied and persisted, and Cancel leaves no session entry behind.
