# Agent Instructions
These are common instructions for agents across all scenarios.

## General Guidelines
1. **Root cause over symptom** - reproduce before fixing; fix where all callers route through, not just the reported path.
2. **Quality over cost** - prefer simplicity, robustness, scalability, and long-term maintainability; development effort is not the deciding weight.
3. **Test intent and behavior** - assert outcomes, contracts, and user-visible behavior, not implementation structure; no implementation-mirroring tests, no exhaustive trivial-case suites, no coverage theater.
4. **Verify at the highest meaningful level** - reproduce bugs in E2E-like setting first; hold UI work to pixel-level scrutiny. Run actual tests/gates and report concrete evidence (command output, test counts, diff refs) - "done" without evidence is not done.
5. **Raise the floor** - fix lint errors, test failures, flakiness, and visual defects you encounter, even when your change did not cause them.
6. **Token budget is a first-class constraint** - prefer compact, targeted output; batch operations to minimize round trips; filter and truncate instead of dumping raw content.
7. **Fail loud** - structured errors, explicit "0 results" over ambiguous empty output; never fail silently.
8. **Make one call do the work** - combine multi-step operations into single commands instead of confirm-then-observe cycles.
9. **Respect generated artifacts** - never hand-edit CHANGELOG.md or any file marked auto-generated.
10. **Clean commits, clean prose** - concise commit messages with no auto-added co-author; plain dash "-", never an em dash; one full sentence per line in long Markdown files.
11. **Short and concise** When reporting information to me, be extremely concise and sacrifice grammar for sake of concision.

## Memory

- **Durable prefs / repeated corrections / lasting decisions** → `memory_add` / `memory_replace` (pi-hermes-memory). One-off task details: no persistence. Failure/correction/insight capture is automatic (background review + correction detection) - never duplicate it manually.
- **Store precedence**: repo/tool evidence wins over memory; AGENTS.md rules win over recalled memory; llm-wiki vault owns wiki knowledge; hermes owns user/project facts and session history.
- **Cross-session history**: use `session_search` when prior-conversation context matters ("what did we discuss about X").
- **pi-observational-memory (long sessions)**: treat reflections as durable session facts - do not redo work observations mark completed. Use `recall` with an observation/reflection id when a decision needs source evidence or a reflection is too compressed to act on; never use `recall` as broad search. Inspect state with `/om:view` / `/om:view full` when memory seems stale or contradictory.

## Asking

Prefer the host's native question tool over plain text: on pi use `ask_user_question` (up to 6 questions per call, 2-4 options each, header ≤16 chars, recommended option first), in plan mode `plan_mode_question` (1-3 per call); on opencode use its `question` tool with the same batching. The tool's own card handles formatting - no custom markdown or emoji on top. Plain-text numbered questions only when no question tool exists.

## Delegation, worktrees, and asking

Load the `agent-routing` skill before delegating to a subagent, leasing a
treehouse worktree, doing .NET work, or asking the user a question. It carries
the subagent table, the branch-aware `fork` routing (fork vs `bg_delegate` vs
`Agent`), the worktree policy, the dotnet-skills routing, and the question-tool
rules. A `fork` child inherits this conversation's branch and can write, so run
mutating forks in a leased worktree.

## Repo mutations, docs, research (treehouse)

Trigger: any task whose output mutates a repo - code, ADR, local docs, research artifacts, config - or writes any file into a git repo.
Load the `agent-routing` skill's "Treehouse worktrees" section before the first edit; lease first (`treehouse get -b feature/<slug> --lease --lease-holder pi-<session-slug> --json`); never edit a repo outside a leased worktree.
End-of-session contract: commit leftovers on the feature branch -> `git push -u origin <branch>` -> `gh pr create --fill` (ready, non-draft) -> `treehouse return <path> --if-lease-id <lease-id>` -> report the PR URL.
Fail loud: on treehouse/`gh`/push failure report the exact error, keep the lease, ask the user; never silently fall back to the shared cwd; never `--force` without explicit approval; `treehouse return` releases the lease only, merging stays the user's call.
Chat-only research writing zero files: no worktree, no PR. Non-git dirs (e.g. `~/.pi/agent`): edit in place, PR requirement not applicable.

## Token efficiency

Token budget is a hard constraint: compact targeted tool output; filter/truncate, never dump raw content or whole files; batch operations; report diffs/summaries, not re-reads.
Long/streaming work runs via a named `bg_run` task, never poll; caveman-style compression (~75%) on request.
Context compression is handled by billion-context server-side; do not replay or re-derive compressed ranges — use `search_context` to find facts, `decompress` to restore an exact range. Operational tool syntax (rtk, ast-grep, fd, bg) lives in the `agent-routing` skill.

## Codemode batching
- Trigger: 3+ independent read-only calls in one step -> one `codemode` script with `Promise.allSettled(...)`.
- Why: each extra agent turn resends full context, so batching read-only calls into one script is a direct cost win.
- Biggest wins: JSON-returning tools (`grep`/`find`, MCP search tools, `batch_web_fetch`) plus aggregation/filtering inside the script.
- Output rule: filter/truncate inside the script and `return` only what the model needs, never raw dumps.
- Shape facts: large tool output in scripts stays outside context (`bash` output up to 1 MiB); `bash` resolves to `{ output, truncated, full_output_path?, exit_code }`; `read` images resolve to image blocks usable with `image()`.
- Fail loud: on `allSettled`, report rejected reasons and explicit "0 results" over ambiguous empty output.
- Do NOT use for: single trivial calls, mutating `edit`/`write` flows, or anything needing sequential results.
- Discovery: `searchTools()`/`describeTool()` for tools not declared inline; declared schemas are already visible, so no extra discovery round trips.
- Source discipline: codemode `code` is raw JavaScript only - never XML/HTML tag wrappers, never pasted RTK output as code (see `codemode-source-discipline` skill).

## Model routing

- Plan mode: `opencode-go/glm-5.3-flash:medium`. Delegates, lanes, and subagents: `opencode-go/muse-spark-1.3-contributor` with `thinking: low`. Implementation and orchestration (main agent): muse with `thinking: medium` (`modeModels.build`).
- Global subagent default lives in `~/.pi/agent/subagents-lite.json` (`agent.default` = muse, `defaultThinking` = low); every `agents/*.md` pins muse + `thinking: low`.
- Fallback: if muse is unavailable, self-switch to `opencode-go/deepseek-v4.1-flash:medium`, report the switch, and continue. pi-subagents-lite has no model-fallback field, so this is a manual instruction, not config.
- Never downgrade user-visible deliverables.

## Async implementation lanes

Only after a plan exists and work partitions cleanly: at most 3 non-overlapping file sets (each file in exactly one lane); each lane is a background subagent (muse:low) working only in the shared treehouse worktree; lanes self-verify and report in ESON (format per `impl-lifecycle` skill).
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

## Enforced idea-to-plan lifecycle

New features and ideas run `brainstorm` -> (`spike` if validation gaps remain, with stated reasons) -> `plan-implementation`, routed by the `impl-lifecycle` skill. The brainstorm approval card is the single gate: once approved, continue straight into `spike` (only when validation gaps remain) or `plan-implementation` in the SAME turn, without asking again. Every stage output and every plan revision still ends its turn with an approval card (`ask_user_question` in normal mode, `plan_mode_question` in plan mode: approve & continue / revise / stop). Nothing proceeds unapproved.
Implementation handoff: `plan_mode_complete` with `autoImplement: "fresh"` in `~/.pi/agent/pi-plan-mode.json` makes the `better-plan-mode` fork (local fork of `@narumitw/pi-plan-mode`, package `~/dev/better-plan-mode/packages/pi-plan-mode`) start the linked fresh implementation session automatically with the resolved runtime (first available `implementationModelPresets` entry = `muse`/medium). Do NOT start a duplicate implementation agent after `plan_mode_complete`; the extension owns that handoff. Without interactive UI (`pi -p`) no automatic handoff runs (plan stays ready).
Wiki persistence: `brainstorm` / `spike` / `implementation-plan` / `decision` custom types form a per-feature chain (brainstorm -> spike(s) -> implementation-plan with dated revision log: date, what changed, why, triggering skill). Lane outputs fold into plan revisions as ESON. Stage transitions flow through pi-observability-plugin; Langfuse push optional when keys exist.
Plan revisions MUST carry all 6 `plan-implementation` sections (goal & scope, file map, symbol contracts, edge cases, first-class test plan, assumptions). Self-audit per the baked-in audit-plan rubric before presenting; missing section = not ready.

## CodeGraph (MUST)

`codegraph_explore` MUST run before proposing edits or opening a plan: every claim about current behavior cites its evidence. The `codegraph-gate` extension hard-blocks `edit`/`write` in git repos and in substantial non-git dirs (>20 files, depth>=2, session cwd as root) until one exploration call this session (or a healthy `.codegraph` index); it fails open with a loud error on tiny dirs, blocklisted roots (/, $HOME, /tmp, /etc, /usr), unrecovered init locks, or missing indexer. Escape: `PI_NO_CODEGRAPH_GATE=1`. Plans without codegraph evidence are not ready.

## Simplification review

On demand via the `simplify-review` skill (wraps ponytail-review), or when the `complexity-nudge` extension fires (ΔLOC > 600, per-file cyclomatic > 15, or file > 400 new LOC; at most twice per session). Fix findings or dismiss with reason; never silently skip.

<!-- CODEGRAPH_START -->
## CodeGraph
Native `codegraph_explore` is the only codegraph surface in pi (no MCP codegraph).
For structural questions (how X works, call paths, what calls what), prefer `codegraph_explore`: verbatim source plus call paths from a tree-sitter AST. Trust its output; do not re-verify with grep. Substantial non-git dirs are indexed like repos (plain lock `<root>/.codegraph/init.lock`); tiny dirs are never indexed; if a result carries a staleness banner naming edited files, read those files.
If `codegraph_explore` responds "isn't indexed / not initialized", do NOT retry codegraph that session; fall back to read/grep/ast_grep immediately.
The `pi-codegraph-auto-init` companion auto-indexes primary checkouts on session start. An interrupted init keeps its lock for explicit recovery: run `codegraph index` from the affected worktree root, then `rmdir` the lock path from the error message, then `/reload`.
<!-- CODEGRAPH_END -->
