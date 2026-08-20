# Pre-daemon-first handover code

Deleted from `src/` and `tests/` in commit `6aebb7c` ("Delete the handover"),
the first step of the daemon-first rewrite (see
`docs/daemon_first_acceptance.md`). Kept here rather than only in git history
because the rewrite is not finished yet, and code that is easy to glance at
beats code you have to `git show` for.

Not wired into the build — `bg-panel.tsx` is not imported anywhere and the
test files are not picked up by `tests/run-all.ts` (it only globs `src/`
sibling `tests/test-*.ts(x)` that are actually present in `tests/`, so having
these here does not add them back to the suite).

**Delete this folder once the daemon-first rewrite ships** (stage 4/5 of the
acceptance doc) and background download has either been rebuilt on the new
architecture or deliberately dropped. Until then it is the reference for what
the old handover did and how it was tested.

## Contents

- `src/bg-panel.tsx` — the tick-background dialog UI
- `tests/test-background.ts`, `test-background-restored.ts` — background
  download + restart-time reattachment
- `tests/test-bg-panel.tsx` — the dialog itself
- `tests/test-bg-toggle-race.ts` — the tick/untick race this session's bugs
  came from
- `tests/test-bg-button-state.tsx` — the button-disabled bugs (`some` vs
  `every`) fixed the night before this rewrite started
- `README-background-downloads-section.md` — the top-level README.md's own
  `## Background downloads` section, as it read before being replaced by
  `## The daemon`. Added later, when the live README was rewritten to match
  this rewrite - kept for the same reason as the code above it.
