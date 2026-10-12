# Agent Instructions
These are common instructions for agents across all scenarios.

## General Guidelines
1. **Root cause over symptom** - reproduce before fixing; fix where all callers route through, not just the reported path.
2. **Quality over cost** - prefer simplicity, robustness, scalability, and long-term maintainability; development effort is not the deciding weight.
3. **Test intent and behavior** - assert outcomes, contracts, and user-visible behavior, not implementation structure; no implementation-mirroring tests, no exhaustive trivial-case suites, no coverage theater.
4. **Verify at the highest meaningful level** - reproduce bugs in E2E-like setting first; hold UI work to pixel-level scrutiny.
5. **Raise the floor** - fix lint errors, test failures, flakiness, and visual defects you encounter, even when your change did not cause them.
6. **Token budget is a first-class constraint** - prefer compact, targeted output; batch operations to minimize round trips; filter and truncate instead of dumping raw content.
7. **Fail loud** - structured errors, explicit "0 results" over ambiguous empty output; never fail silently.
8. **Make one call do the work** - combine multi-step operations into single commands instead of confirm-then-observe cycles.
9. **Respect generated artifacts** - never hand-edit CHANGELOG.md or any file marked auto-generated.
10. **Clean commits, clean prose** - concise commit messages with no auto-added co-author; plain dash "-", never an em dash; one full sentence per line in long Markdown files.
11. **Short and concise** When reporting information to me, be extremely concise and sacrifice grammar for sake of concision.

## Memory

Persistent preferences, repeated corrections, and decisions with lasting consequences go through the `memory_add` / `memory_replace` tools (pi-hermes-memory) - not for one-off task details. Wiki vault duties are handled by llm-wiki.

## Asking

Prefer the host's native question tool over plain text: on pi use `ask_user_question` (up to 6 questions per call, 2-4 options each, header ≤16 chars, recommended option first), in plan mode `plan_mode_question` (1-3 per call); on opencode use its `question` tool with the same batching. The tool's own card handles formatting - no custom markdown or emoji on top. Plain-text numbered questions only when no question tool exists.

## Delegation, worktrees, and asking

Load the `agent-routing` skill before delegating to a subagent, leasing a
treehouse worktree, doing .NET work, or asking the user a question. It carries
the subagent table, the worktree policy, the dotnet-skills routing, and the
question-tool rules.

## Repo mutations, docs, research (treehouse)

Trigger: any task whose output mutates a repo - code, ADR, local docs, research artifacts, config - or writes any file into a git repo.
Load the `agent-routing` skill's "Treehouse worktrees" section before the first edit; lease first (`treehouse get -b feature/<slug> --lease --lease-holder pi-<session-slug> --json`); never edit a repo outside a leased worktree.
End-of-session contract: commit leftovers on the feature branch -> `git push -u origin <branch>` -> `gh pr create --fill` (ready, non-draft) -> `treehouse return <path> --if-lease-id <lease-id>` -> report the PR URL.
Fail loud: on treehouse/`gh`/push failure report the exact error, keep the lease, ask the user; never silently fall back to the shared cwd; never `--force` without explicit approval; `treehouse return` releases the lease only, merging stays the user's call.
Chat-only research writing zero files: no worktree, no PR. Non-git dirs (e.g. `~/.pi/agent`): edit in place, PR requirement not applicable.

## Token efficiency

Token budget is a hard constraint: compact targeted tool output; filter/truncate, never dump raw content or whole files; batch operations; report diffs/summaries, not re-reads.
Long/streaming work runs via a named `bg_run` task, never poll; caveman-style compression (~75%) on request.
Mechanical context pruning is handled by pi-dcp; do not manually fight it. Operational tool syntax (rtk, ast-grep, fd, bg) lives in the `agent-routing` skill.

## Model routing

Plan mode, repo survey, and read-only research delegates run on the cheapest capable model route available to the session; implementation and verification stay on the session's default quality route.
Never downgrade user-visible deliverables.

## Async implementation lanes

Only after a plan exists and work partitions cleanly: at most 3 non-overlapping file sets (each file in exactly one lane); each lane is a background subagent working only in the shared treehouse worktree; lanes self-verify and report.
After all lanes report, the orchestrator runs the full test suite once in the shared worktree; resolve cross-lane dependencies explicitly, never merge blindly.

## Orchestrators
UI/design/prototype/UX-refinement requests -> read the design-orchestrator skill first (carries the XIAS routing table).
Code review / simplification / quality requests -> read the code-review-orchestrator skill first.
Security review/audit or auth/secrets/input work -> read the security-orchestrator skill first.

## Spine + visual routing
- Spine repos (goals/+backlog/+specs/): scope via plannotator-setup-goal, slices via slice-tasks, execute via execute-plan, record via session-state; trivial fixes via quick-fix.
- Visual routing: plan output→Plannotator hook; diffs→plannotator-review; plans/explainers/tables→plannotator-visual-explainer; freeform artifacts→Lavish; diagrams→Archify; task board→`npx backlog board`. Table wins on conflict.
- Research-first: load research/find-docs before exploring. Stack defaults: ~/.pi/agent/OPINIONS.md (project deviations win). VISION.md required per repo (/vision).

## UI work (XIAS kit)
- **Trigger**: any session touching a visual interface - pages, dashboards, components, themes, or audits.
- **Route doctrine-first**: read the `design-doctrine` skill before writing UI code, then follow the design-orchestrator routing table for the request stage. (Full table lives in the design-orchestrator skill.)

- **Command-only skills** (user-invoked, never model-loaded): `/brandkit` `/governance` `/image-to-code` `/migrate-design-system` `/prototype` `/redesign` `/gate` `/critique` `/grill-me` `/ship` `/scaffold-project`.
- **Rigor by artifact maturity**: throwaway prototype earns doctrine plus the cheap gate pair (`lint_hardcodes.py` + `check_no_emoji.py`, plus `validate_contrast.py` when tokens were used); skipped render gates logged as a deliberate tradeoff. Real or production UI earns the full gate set from the kit's `docs/GUIDE.md` plus a critique pass; every finding is fixed or explicitly dispositioned, never skipped silently. Prefix one render gate with `DS_REQUIRE_BROWSER=1` so a `SKIPPED` result fails loudly.
- Kit lives at `~/.agents/ux-ui-agent-skills` (pi names drop the `xias-` prefix); resolve `${CLAUDE_SKILL_DIR}` to the loaded skill's own directory.

<!-- CODEGRAPH_START -->
## CodeGraph
For structural questions (how X works, call paths, what calls what), prefer `codegraph_explore`: verbatim source plus call paths from a tree-sitter AST. Trust its output; do not re-verify with grep. Non-git dirs are never indexed; if a result carries a staleness banner naming edited files, read those files.
<!-- CODEGRAPH_END -->
