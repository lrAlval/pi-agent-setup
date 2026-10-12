---
name: implement
description: Build a backlog slice per its acceptance criteria with TDD at seams, prove-fix verification, and spine state updates. Use when a backlog/<id> task file exists.
---

# Implement (spine-adapted)

Read the slice. Build the slice. Prove the slice. Record the slice.

## Input

- `backlog/<id>-*.md` (acceptance criteria are the contract)
- `specs/state.yaml` (current position), `specs/decisions.md` (constraints)

## Protocol

1. Confirm acceptance criteria; unclear scope -> scope-sharpener first.
2. TDD at pre-agreed seams (`tdd` skill). Typecheck + single-file tests during, full suite once at end.
3. Prove-fix (built-in, not a separate skill): re-run the original failing test, re-run the repro, run the full suite. Deliberately-broken fix must be caught here.
4. Review: routine -> `review` agent; big PR -> `no-mistakes` on demand only (never the daily default).
5. Record: backlog status -> done, state.yaml via session-state, commit on current branch.

Bugs with unknown cause go to `diagnosing-bugs` before any fix. Repo
writes follow the treehouse PR contract (commit -> push -> gh pr -> return).
