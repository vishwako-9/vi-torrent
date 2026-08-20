# Component Spec: `src/bg-panel.tsx`

> **Updated for multi-select.** The panel now takes `targets: () => TorrentItem[]`
> instead of a single `torrent`, because the BG button acts on every ticked
> row. Three things follow from that:
>
> - The title reads either the torrent's name or `N torrents`.
> - A **mixed** selection, some already in the background, some not, always
>   counts as dirty, so Save is meaningful whichever way the box is left. The
>   point of the dialog on a mixed set is to make it agree. Without this, a
>   mixed selection opened unticked would look "unchanged" and Save would
>   quietly do nothing.
> - `onSave` skips targets already in the wanted state. The engine only offers
>   `toggleBackground`, so a blind toggle would flip half a mixed selection the
>   wrong way.
>
> The `untrack()` note below is unchanged and still load-bearing: `targets()`
> reads the app's 1-second refresh signal, so the open-sync effect would
> otherwise re-run every second and reset the checkbox between keystrokes.


**File Path:** [src/bg-panel.tsx](../src/bg-panel.tsx)
**Role:** The Background dialog. Decide whether a torrent downloads in the background, then Save.

---

## 1. Why it exists

The BG checkbox used to act the instant it was clicked. That made a
heavyweight operation, releasing a torrent from this process and handing it
to another, indistinguishable from a stray click, and clicking it twice
quickly lost the row entirely (see
[the handover window](doc_src_engine_ts.md#the-handover-window)).

Now the checkbox only changes what is on screen. Nothing happens until
**Save**; **Cancel** leaves the torrent exactly as it was.

**This is not the original design.** The first version set a flag and
performed the handover at exit, which made ticking BG appear to do nothing
at all, and was reported as the checkbox being broken. Save still applies
immediately. Only the *decision* is deferred, never the effect.

## 2. Functional Specification

1. Opened by the **Background** button, which no longer acts on its own.
2. Shows the torrent name, a checkbox, and what Save will do, "handed to the
   background downloader" or "taken back into this window", but only when the
   choice actually differs from the current state.
3. `space` (or a literal `" "`), `left`, `right`, `up`, `down` all flip the
   box; clicking the checkbox row does too.
4. `enter` saves, `escape` cancels, and the Save / Cancel buttons are
   clickable.
5. Saving with nothing changed simply closes: it is not an error to press
   Save on an unchanged dialog.
6. Frame and key routing come from [`Overlay`](doc_src_overlay_tsx.md) at
   priority **28**, above Settings (25) and Details (20), below Add (30).

## 3. Two bugs this surfaced

### The open-sync effect fought the refresh timer

The obvious way to load the checkbox from the torrent is:

```ts
createEffect(() => {
  if (isBgOpen()) setChecked(props.torrent()?.background ?? false);
});
```

`props.torrent()` reads the `torrents()` signal, which `app.tsx` **rewrites
every second**. So the effect re-ran on every refresh and reset the checkbox
to the engine's value, silently undoing the user's tick between keystrokes.
The box simply refused to stay ticked.

Only the *open transition* may write it, and the read is wrapped in
`untrack()` so the refresh cannot trigger it at all:

```ts
let wasOpen = false;
createEffect(() => {
  const open = isBgOpen();
  untrack(() => {
    if (open && !wasOpen) { setChecked(...); setNotice(""); }
    wasOpen = open;
  });
});
```

### Space was reported two ways

The panel originally matched only `"space"`. Terminals send either `"space"`
or a literal `" "`, the pair the Add and Details panels already accepted.

## 4. Tested by

`tests/test-bg-panel.tsx`: opening the dialog does **not** hand the torrent
over; ticking changes the screen and not the engine; Cancel discards; Save
applies; re-opening shows the real current state; and unticking through the
same dialog brings the torrent back.

**A trap that suite documents**: the body explains what Save will do ("On
Save: handed to the background downloader"), and that line comes *before* the
button row, so clicking the first line containing "Save" clicks explanatory
text. The button row is the one carrying **both** buttons. This is the same
shape as the Add dialog's title-versus-button trap.
