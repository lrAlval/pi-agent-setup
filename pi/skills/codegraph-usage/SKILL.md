---
name: codegraph-usage
description: Load before structural code questions - how X works, how X reaches Y, what calls what, where X is defined. Covers codegraph_explore usage, auto-init/sync, and staleness handling.
---

# CodeGraph usage

For structural questions (how X works, how X reaches Y, what calls what, where X is defined), prefer the `codegraph_explore` tool over grep/read: it returns verbatim line-numbered source plus call paths and a blast-radius summary from a tree-sitter AST.
Trust its output; do not re-verify with grep.

- No `codegraph_explore` tool? Ask before running `codegraph init -i` (interactive setup only).
- A git repo (`.git` dir or file, worktrees included) missing `.codegraph/` is auto-initialized in the background by the `codegraph-sync` plugin at session start or on first codegraph tool use. Init results catch up on the next round-trip: the first explore calls right after init may run while the index still builds. Non-git dirs are never indexed.
- The `codegraph-sync` plugin also debounce-runs `codegraph sync --quiet` (when `.codegraph/` exists) at session start and on codegraph tool use, covering worktree switches, rebases, and merges.
- If a result carries a staleness banner naming edited files, read those specific files; everything outside the banner is fresh.
- The plugin still auto-inserts its canonical block at runtime; when present, that block wins over this skill on setup specifics.
