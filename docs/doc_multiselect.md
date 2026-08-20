# Feature Spec: acting on several torrents at once

**Files:** [src/app.tsx](../src/app.tsx), [src/bg-panel.tsx](../src/bg-panel.tsx), [src/theme.ts](../src/theme.ts)
**Role:** Tick several torrents, then Pause / Resume / Remove / Remove + Files / Background all of them in one press.

---

## 1. Why

Every action used to resolve against one number:

```ts
const t = engine.getTorrents()[selectedIndex()]   // app.tsx, before
```

`SEL` was a radio marker, `(o)` / `( )`, so pausing eight torrents meant
eight arrow-and-press cycles. Reported as: *"suppose I have multiple items in
a list and I want to pause them all or delete them all at once"*.

## 2. Cursor and selection are two different things

This is the whole design, and conflating them is the mistake to avoid.

| | Cursor | Selection |
| :--- | :--- | :--- |
| What it is | where you are | what actions hit |
| Shown by | the accent-coloured **name** | `[x]` in the **SEL** column |
| Moved by | arrow keys, and a click | click, `All`, `None`, `/select-all` |
| Can be empty | **no**: Details needs a subject | **yes**, and it starts empty |

The cursor keeps showing through the name colour rather than a second marker,
because two markers on one row is something you have to stop and decode.

## 3. The fallback that keeps single use cheap

```ts
const targetIds = (): number[] => {
  const ticked = live.filter(t => checked().has(t.id)).map(t => t.id);
  if (ticked.length > 0) return ticked;
  const cursor = selectedLive();
  return cursor ? [cursor.id] : [];
};
```

**Nothing ticked ⇒ the cursor row.** Not a convenience: without it, pausing one
torrent would require ticking it first, which is worse than the behaviour this
replaced. Every button, and `/pause` `/resume` `/remove`, route through it.

An explicit id argument (`/pause 3`) overrides the selection entirely.

## 4. IDs, not indices

`checked` is a `Set<number>` of **torrent IDs**. Row indices shift the moment
anything is removed, so a stale index would act on a torrent's neighbour,
and one of these actions deletes files.

IDs are never reused, so a stale tick cannot reattach to a different torrent.
It is still pruned in `updateTorrents()`, because a tick for a departed
torrent would keep the header count wrong and leave a delete armed against
something already gone.

Targets resolve against **the engine**, not the rendered rows: the table
repaints on a 1-second tick and can be a second out of date.

## 5. Failures do not stop the batch

`act()` runs every target and collects errors rather than throwing on the
first. Pausing eight torrents should not abandon seven because one was mid
handover. One failure is reported as itself; several as
`"<first>  (and N more)"`.

## 6. Remove + Files

Two clicks, armed against **the target signature** (`targetKey()`, the joined
ids) rather than one torrent id:

```
Remove + Files  →  Click again: delete 7 + files
```

Changing the selection between the clicks disarms it. Arming on one set and
deleting a different one is the failure that actually matters, because this is
the only action here that cannot be undone. The count is in the label because
"Click again to delete" gives no clue how much is about to go.

## 7. Background on a mixed selection

The button shows the split instead of a box that has to lie about one of two
states:

| Selection | Label |
| :--- | :--- |
| none in background | `[ ] Background (7)` |
| all in background | `[x] Background (7)` |
| mixed | `[-] Background (3/7)` |

The dialog then says *"Right now 3 of 7 are in the background. Saving makes
them all the same."* See [bg-panel](doc_src_bg_panel_tsx.md) for why mixed
always counts as dirty.

## 8. Why the space bar is not the toggle

The command input holds focus permanently, so space types a space. `Space`
would have to be stolen from the one control the user is typing into.
`/select-all` and `/select-none` are the keyboard route, which also keeps them
discoverable in the `/` list alongside every other action.

## 9. Background ticks are NOT cleared on launch

Considered and rejected. Clearing them would fix a real confusion, a tick
made weeks ago still hands torrents over today, but introduces a worse one:
open vi-torrent to check progress, close it again, and downloads you expected
to continue stop silently.

Instead the ticks persist and **quitting names what will keep going**, with a
count and the first five names. The invisible-orphan problem is solved by
saying it out loud, not by discarding the user's decision.

## 10. A WebTorrent race this made easy to hit

Bulk-pausing four torrents filled the screen with:

```
Error: null is not an object (evaluating 'this.swarm.private')
  at handshake (webtorrent/lib/peer.js:201:17)
  ...
  at onCryptoInfoHash (webtorrent/lib/conn-pool.js:153:20)
```

Not caused by this feature; exposed by it. `conn-pool.js` sets `peer.swarm`
and then **awaits** the encrypted handshake. If the torrent stops inside that
window, `peer.destroy()` nulls the swarm (`peer.js:246`) and the deferred
`handshake()` reads `this.swarm.private` on a dead peer. Pausing four torrents
destroys four swarms at once, so the window is hit almost every time; a single
pause hits it rarely.

It is benign, the peer is already gone and no torrent state is touched, so
`isPeerTeardownRace()` in [engine.ts](../src/engine.ts) drops it before it
reaches the error line.

Matched on the **stack**, not the message: the wording is engine-specific, and
V8's form (`Cannot read properties of null (reading 'private')`) does not
contain the word "swarm" at all. Narrow on purpose: a `TypeError` anywhere
else, including elsewhere in `peer.js`, still reaches the user, which is what
most of `tests/test-peer-teardown.ts` asserts.

## 11. Tested by

`tests/test-multiselect.tsx`: 20 checks, driven by real clicks: nothing
ticked on launch, All/None, bulk pause and resume, **the cursor-row fallback**,
a partial selection leaving the third torrent alone, the slash commands, the
armed delete naming its count, disarming on selection change, and a real bulk
delete.

`tests/test-mouse.tsx`: click ticks, click again unticks, a second row does
not clear the first, the header is inert.

`tests/test-table.tsx`: empty checkboxes on a fresh table and **nothing
ticked by default**, which is the check that matters: a default tick would arm
bulk actions on launch.
