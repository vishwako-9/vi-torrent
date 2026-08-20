# codemie-opencode TUI — Overview

Research into `packages/opencode/src/cli/cmd/tui/` in codemie-opencode (an MIT-licensed fork of sst/opencode), read as a reference for a full, polished `@opentui` + SolidJS terminal app — the same role aria2's C++ source played for our earlier libtorrent work. 68 source files read in full; see the sibling `opentui-*` docs (written separately) for the underlying rendering/layout framework itself. This set covers how the framework is actually *used* to build a real app.

## Contents

1. [opencode-tui-01-app-bootstrap.md](./opencode-tui-01-app-bootstrap.md) — process entry point: `app.tsx`'s provider-stack bootstrap, the worker-thread/RPC split, and the Win32 `bun:ffi` Ctrl+C/console-mode fixes (directly relevant to us).
2. [opencode-tui-02-context-providers.md](./opencode-tui-02-context-providers.md) — the state-management layer: one `createSimpleContext` factory reused for every concern (route, theme, keybind, sync'd server state, local prefs); no Redux/Zustand, pure Solid stores/signals.
3. [opencode-tui-03-routing-and-screens.md](./opencode-tui-03-routing-and-screens.md) — the two-route router (home/session) and the session screen's header/footer/sidebar chrome, our closest analogue to the torrent-list + status bar.
4. [opencode-tui-04-command-palette-and-dialogs.md](./opencode-tui-04-command-palette-and-dialogs.md) — the command palette: a registration-based command bus (no central list) plus `fuzzysort`-powered matching, and ~10 concrete dialogs built on one shared list primitive. Single most relevant file to our app.
5. [opencode-tui-05-dialog-ui-primitives.md](./opencode-tui-05-dialog-ui-primitives.md) — the generic modal stack, the reusable `DialogSelect` fuzzy list component everything else is built from, confirm/alert/prompt dialogs, and the toast system.
6. [opencode-tui-06-prompt-input.md](./opencode-tui-06-prompt-input.md) — the text input box: extmark-based attachment tracking, `@`/`/` autocomplete with frecency ranking, paste handling, history/stash persistence.
7. [opencode-tui-07-small-components-and-logo.md](./opencode-tui-07-small-components-and-logo.md) — border constants, the animated ASCII-block logo (answers the "big logo?" question), spinner, tips, todo row.
8. [opencode-tui-08-utils.md](./opencode-tui-08-utils.md) — cross-platform clipboard (incl. Windows PowerShell-via-stdin and OSC 52 SSH fallback), external editor invocation, terminal color querying, transcript formatting.

## Synthesis: what we should copy

**Architecture pattern.** The whole app is: one root component (`app.tsx`'s `App()`) switching over a tiny router store, wrapped in a deep-but-flat stack of SolidJS context providers built from a single ~15-line factory (`createSimpleContext`). There is no framework-specific state library beyond `solid-js`/`solid-js/store` themselves. This is directly adoptable — we don't need Redux/Zustand/anything else; a handful of `createStore`-backed contexts (torrent-sync, theme, keybind, dialog, command, kv-prefs) covers everything their ~15 contexts cover, scaled down to our smaller feature surface.

**Command system.** Their single best idea for us: commands are *registered by the component that owns them*, not centrally listed. A `CommandProvider` context collects `() => CommandOption[]` accessor functions from every currently-mounted component (`onCleanup` removes them on unmount), so screen-scoped commands (e.g. "remove selected torrent," only meaningful when a row is focused) exist exactly while relevant, with no manual enable/disable bookkeeping. Every command optionally declares a `slash: {name, aliases}`, making it reachable by keybind, by the `ctrl+p` palette, and by typing `/name` in a prompt box — one registration, three entry points. Matching is off-the-shelf `fuzzysort`, not hand-rolled.

**Dialog system.** One generic `DialogProvider` (single-slot "stack," really just replace/clear) plus one generic `DialogSelect` component (fuzzy search, category grouping, keyboard+mouse nav, per-dialog extra keybinds) that essentially every concrete dialog is a thin wrapper around. Our `SettingsModal`/`PeerModal`/`FileModal`/`TorrentLimitModal`/`InputModal` should all collapse onto this same pair of primitives rather than being five separately-built modal implementations.

**Windows-specific concerns.** Two real, hard-won fixes worth porting close to verbatim since we're Windows-first: (1) `win32.ts`'s `bun:ffi`-based `kernel32.dll` calls to clear `ENABLE_PROCESSED_INPUT` so Ctrl+C arrives as a keypress instead of killing the process group, installed *before any other async work*; (2) `util/clipboard.ts`'s Windows clipboard path (PowerShell invoked with the text piped via stdin, never interpolated into the command string) plus the always-on OSC 52 write for SSH-tunneled sessions.

**Visual identity.** The "big logo" question has a concrete answer: yes, a real multi-line ASCII block-art wordmark (4 lines, `█▀▄` characters), but its polish comes from an animated left-to-right color-sweep plus a shadow-marker bevel effect layered on top — not from sheer size — and everything animated has a static, `animations_enabled`-gated fallback. If we build a comparable splash for our home screen, budget for the animation and fallback together, not just the raw art.

## Suggested file/folder structure for our app

Following this same architecture, a plausible layout under our own `src/tui/` (or equivalent):

- `app.tsx` — entry point: terminal-theme detection, provider-stack mount, root component switching between our screens (likely just "main" and maybe a "detail" view, versus their home/session split).
- `win32.ts` — ported near-verbatim from theirs: Ctrl+C guard, processed-input toggle, input-buffer flush.
- `context/` — one file per concern, each built on a shared `createSimpleContext` helper: `torrent.ts` (the sync store — torrent list, per-torrent status/peers/files, fed by libtorrent IPC instead of SSE), `theme.ts` (RGBA theme object; far fewer built-in themes than their ~30), `keybind.ts`, `kv.ts` (persisted UI prefs), `dialog.tsx`, `command.tsx` (the registration-based command bus), `route.tsx` (only if we end up with more than one screen).
- `routes/` (or `screens/`) — `main.tsx` (the torrent table + header + footer, our equivalent of their `home.tsx`/`session/index.tsx` combined, since we don't have a separate landing page), with header/footer/sidebar as sibling files if the main screen grows large enough to warrant splitting like their `routes/session/` did.
- `component/dialog-*.tsx` — one file per concrete dialog (add-magnet, settings, peers, files, torrent-limits), each a thin `DialogSelect`/`DialogPrompt` wrapper, mirroring their `dialog-agent.tsx`/`dialog-mcp.tsx` style.
- `ui/` — the generic primitives: `dialog.tsx` (stack host), `dialog-select.tsx` (the fuzzy list — our single most important port), `dialog-confirm.tsx`/`dialog-prompt.tsx`, `toast.tsx`.
- `component/` — small leaves: `logo.tsx` (+ a `logo-data.ts` sibling for the raw ASCII, mirroring their `cli/logo.ts` split), `spinner.tsx`, `border.tsx` constants.
- `util/` — `clipboard.ts` (ported), `editor.ts` (if we add an external-editor escape hatch), `signal.ts` (debounce helper), `terminal.ts` (background-color detection — pick one implementation, don't duplicate it like they did).

This is deliberately a subset of their structure — we have no SDK/sync/session-fork/multi-agent concepts, so `context/sdk.tsx`, `context/sync.tsx`'s server-reconciliation complexity, `component/prompt/frecency.tsx`, and most of `routes/session/index.tsx`'s tool-renderer sprawl have no direct equivalent and shouldn't be copied just because they exist in the reference.
