---
name: pr-review
description: "Review an open GitHub PR on demand. Triggers: review PR, review PR #N, review my PR, review the PR queue, which PR should I review, PR review on demand."
argument-hint: "[PR number | PR URL | empty = queue/auto]"
---

# PR review — unified on-demand open-PR review

One skill for open-PR review. Zero improvisation: follow these stages in order.
Approval-first: NOTHING touches the working tree or posts to the PR before
the stage-5 approval card. Fixes are per-finding: tool reports, human
approves/skips each finding, model auto-fixes approved ones only.

## 0. Todos (mandatory, live)

Create at invocation via the harness todo tool:

`resolve PR`, `fetch PR context`, `spec gate`, `worktree + codegraph index`,
`preflight rules + preview`, `two-axis review`, `persist ledger + render`,
`approval card`, `gated fix loop`, `post PR comment (if approved)`,
`cleanup / fix handoff`.

Each step: `in_progress` before its work, `completed` immediately after.
Failing step stays `in_progress` with blocker recorded.
Plan mode (todo unavailable): state step list in prose, proceed unchanged.

## 1. Resolve target PR

Input forms: PR number (`42`), URL (`.../pull/42`), `#42`, empty, fuzzy ("the auth PR").

- Number/URL/`#N`: extract number, verify via:
  `gh pr view <N> --json number,title,headRefName,baseRefName,body,comments --repo <owner/name>`
  Bad number → fail loud, quote `gh` error verbatim. Todo `resolve PR` blocked.
- Empty input: run helper, parse output:
  `node <skill-dir>/_helpers/pr-queue.mjs <repo-cwd>`
  - `pr_count: 0` → report "no open PRs", stop (valid, not error).
  - Exactly one PR → auto-pick, no question. State so.
  - Multiple → queue mode (§2).
  - Helper exit 1 → quote `error:` line verbatim, stop.
- Fuzzy ("the auth PR"): `gh pr list --state open --json number,title --limit 30`,
  then `ask_user_question` (options = candidate titles, plus restatement).
  Pass chosen number verbatim.

## 2. Queue mode (multiple open PRs)

Helper prints `review_order: n1,n2,n3` + `why:<n>: <reason>` lines.
Ask once via `ask_user_question`: one question, options = top 3 in computed
order (+ type-in), recommended first, label includes `why` reason.
User pick → that PR is the target. Do not re-rank.

## 3. Fetch PR context (target chosen)

Run and keep for later steps:

```
gh pr view <N> --json number,title,body,headRefName,baseRefName,comments,reviews --repo <owner/name>
gh pr diff <N> --repo <owner/name> | head -100   # shape check only
```

Todo `fetch PR context` completed. Full diff review happens in worktree (§5).

## 4. Spec gate (warn + partial — never a hard stop)

Read PR body + linked issues (`#N` refs in body → `gh issue view`).
Missing spec (helper `spec_present=false` and no linked-issue spec found):

- Print: `WARNING: PR #<N> has no spec in body or linked issues — spec axis will be skipped`
- Run **standards axis only** (§6). Mark report header `no spec — spec axis not run`.
- If user later approves posting (§9), note missing spec in PR comment.
- Todo: `spec gate` completed-with-note, `spec axis` marked skipped.

Spec found → both axes run.

## 5. Worktree + codegraph index (read-only review checkout)

From repo root:

```
git fetch origin pull/<N>/head
git worktree remove --force .worktrees/pr-<N>-review/   # only if path already exists; state so
git worktree add -b review/pr-<N>-<sha7> .worktrees/pr-<N>-review/ FETCH_HEAD
```

Named branch, committable — never detached HEAD. All review-stage
commits (§8 ledger, §10 fixups) happen inside this worktree on this
branch. **The main checkout is never modified or committed to by this
skill — any review or fix change made outside the worktree is a
contract violation.** Verify with `git -C <main-root> status --short`
before any commit and treat unexpected dirty files as pre-existing
user work (do not stash, revert, or commit them).

Then from worktree root: `codegraph index`.
On interrupted init: remove the `codegraph` lock path per repo CodeGraph
contract, retry once. Index failure → worktree stays, todo blocked, tell user
to run `codegraph index` manually in worktree. Review does NOT proceed
unindexed (codegraph-backed blast radius is contract, not nicety).

Empty diff check: `git diff <merge-base>...HEAD` where merge-base =
`git merge-base HEAD <base>` (base = PR base ref). Empty → report
"no changes against base", stop (no comment offered, no empty review).

No source files are modified in this stage. The worktree is a read-only
review checkout until the stage-7 approval card passes.

## 6. Preflight: rules check + delegate preview (warn + continue)

From the worktree root (never the main checkout), before any review subagents:

```
ocr rules check <touched-file> --repo <worktree-root>   # expect project rule hit
ocr delegate preview --from <base> --to <head> --repo <worktree-root>
```

- `rules check` failure (missing binary, no rule hit, bad JSON) →
  `WARNING: rules preflight failed (<reason>) — continuing without rule routing`.
  Never a hard stop. Delegation still works without rules.
- `delegate preview` confirms scope: reviewable vs excluded
  (`user_exclude`, `unsupported_ext`). If `web/vendor/` or generated files
  appear as reviewable, stop and fix `.opencodereview/rule.json` excludes first.
- Global rules live at `~/.opencodereview/rule.json` (universal + CI +
  config + package policies). Per-repo rules at
  `<repo>/.opencodereview/rule.json`, passed via delegation `--rule` flag.
  Custom rule JSON schema: `{rules:[{path, rule, merge_system_rule?}],
  include?, exclude?}` — layer priority custom > project > global > system,
  first match wins. See pi-agent-setup#14.

Todo `preflight rules + preview` completed (or completed-with-warning).

## 7. Two-axis review (code-review engine + OCR delegation)

OCR delegation (PR-scope precision reviewer):

```
ocr delegate preview --from <base> --to <head> --repo <worktree-root>
ocr delegate rule <touched-paths...> --repo <worktree-root>   # rule routing per file
```

Run `ocr review` only if an LLM endpoint is configured; default path is
**delegation-only** (no endpoint needed, results stay in-agent).
One-file-group-per-run if prompts hit API limits (PR-58 lesson).

Then build prompts per `/home/aiden/.agents/skills/code-review/SKILL.md`
steps 3–4:

- Standards prompt: diff command (`git diff <merge-base>...HEAD`, run inside
  worktree) + commit list + standards sources + Fowler smell baseline pasted
  verbatim. Brief: violations per file/hunk, hard vs judgement-call split,
  under 400 words.
- Spec prompt (skip entirely if §4 flagged missing spec): diff + spec contents.
  Brief: missing/partial, scope creep, looks-wrong implementations, quote spec
  line per finding, under 400 words.

Run as **parallel subagents**, outputs kept separate.
Codegraph-backed blast radius: each axis cites impacted callers/callees.
Todo `two-axis review` updated per axis.

Aggregate: `## Standards` + `## Spec` headings, verbatim or lightly cleaned.
Do NOT merge or rerank (engine forbids it). One-line summary per axis:
total findings + worst issue within that axis.

## 8. Persist: ledger + HTML + viewer shim (zero-cost ledger)

Canonical ledger is repo-committed `reviews/pr-<N>.json` plus rendered
`reviews/pr-<N>.html`. Helper (zero-dep, Node>=22 ESM):

```
node <skill-dir>/_helpers/ledger.mjs upsert reviews/pr-<N>.json findings.json --sha <head-sha>
node <skill-dir>/_helpers/ledger.mjs render reviews/pr-<N>.json reviews/pr-<N>.html
node <skill-dir>/_helpers/ledger.mjs shim reviews/pr-<N>.json --repo <repo-root> \
  --session pr-<N>-<sha7> --sha <head-sha> --from <base> --to <head> --branch <head-ref>
```

- Ledger schema: `{v:1, pr, findings:[{id,file,line,check,severity,status,
  firstSeenSha,lastSeenSha,note?}]}`. Match = same file AND same check AND
  `|lineDelta|<=3` → update line+lastSeenSha, preserve status/id.
  Else append `f###` open. Stable ids, never reused. See pi-agent-setup#15.
- `diff` classifies without mutating: `{new,persistent,fixed}` on stdout.
- `mark` transitions status (human-gated): `open|fixed|wontfix` only.
- `render` is self-contained escaped HTML, no external refs. Empty ledger
  renders an explicit empty state (not an error).
- `shim` synthesizes OCR session JSONL into
  `~/.opencodereview/sessions/<encoded>/<id>.jsonl` (session_start +
  review_item_done per file + session_end with run_manifest, terminal
  `complete`). Verify via `ocr session list` + `ocr session export -o`.
  Shim is included in Phase 2 scope (user-locked).

Commit `reviews/pr-<N>.json` + `.html` inside the review worktree on its
named branch `review/pr-<N>-<sha7>`. The main checkout
is never touched by review work (PR-58 lesson: 14 uncommitted main-tree
fixes came from pre-gate in-session editing).

Todo `persist ledger + render` completed.

## 9. Approval card (the gate — nothing before this touches tree or posts)

Present the local report (ledger summary + HTML path + viewer session id),
then `ask_user_question` with per-finding decisions:

1. **Per-finding fix approval:** for each open finding, approve or skip.
   Tool reports, human approves/skips, model auto-fixes approved ones only.
   Skipped findings stay open (or move to `wontfix` via `mark` with reason).
2. **Post findings comment to PR?** Default/recommended = "keep local only".
   Nothing posts without explicit approval. If approved:
   `gh pr comment <N> --body-file <tmp> --repo <owner/name>`
   Body labeled `<!-- automated-review-record -->`, header includes spec status.
   Comment failure → loud warning, not review failure.

No working-tree modification and no `gh pr comment` happen before this card
resolves. The card is the single gate for both fix and post paths.

Todo `approval card` completed with user choices recorded.

## 10. Gated fix loop (approved findings only)

For approved findings only, in the review worktree:

1. Apply minimal fix per finding (one finding → one focused edit).
2. Commit as fixup inside the review worktree on its named branch
   `review/pr-<N>-<sha7>` (never detached, never the main checkout).
3. Re-run review inputs (`ocr delegate preview`, targeted subagent or
   `git diff` re-check), then:
   `node <skill-dir>/_helpers/ledger.mjs diff reviews/pr-<N>.json findings-rerun.json`
4. `mark` resolved findings `fixed` (human confirms), re-render HTML + shim.
5. Repeat until approved findings are fixed or user stops. Unapproved or
   skipped findings are never auto-fixed.

Todo `gated fix loop` completed per finding.

## 11. End: approval-gated comment + cleanup / fix handoff

- Posting: only after §9 approval #2. Keep-local is the default; posting is
  the exception, never the pipeline.
- Stop → `git worktree remove --force .worktrees/pr-<N>-review/` + branch
  ref cleanup. Fix-continue → keep worktree, hand off to fix flow.
- Replication: after lazy-diff proves the loop on its next PR, replicate
  rule files + ledger practice to Voxa / pi-agent-setup / Horus /
  PR-Reviewer / Restfix.Platform per pi-agent-setup#17 checklist.

Todo `post PR comment (if approved)` + `cleanup / fix handoff` completed.

## Failure modes (quick ref)

Zero PRs → "no open PRs", stop. gh missing/unauth/longed-out/rate-limited,
non-GitHub repo → quote helper `error:` verbatim, stop. Stale worktree path →
remove first, state so. codegraph fail → blocked, manual index. Rules
preflight fail → warn + continue (never hard stop). Comment fail →
loud warning only. Cycles/unknown deps → SCC-collapsed, noted in `why`.
Plan mode → prose steps. Windows/macOS/Linux safe (no shell interpolation
into `gh` args; paths via helper `node:path`).
Ledger exits: 2 invalid JSON/input, 3 missing --sha, 4 unwriteable output,
5 unknown id/status — all fail loud with the message quoted.
