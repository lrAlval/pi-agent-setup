---
name: agent-routing
description: Load before delegating to a subagent, leasing a treehouse worktree, doing .NET work, or asking the user a question. Carries the subagent table, worktree policy, dotnet-skills routing, and ask_user_question rules.
---

# Agent routing

Applies across every pi session and every repo. Complement the primary agent
(build/plan) with subagents; delegate instead of doing the work inline.

## Non-negotiables

- Never propose a bug fix before `bug-detective`.
- Never edit shared, public, or unfamiliar-ownership code before `blast-radius`.
- Never suggest infrastructure changes before `foreman`.
- On first contact with a repo this session, delegate discovery to `surveyor` before anything else.
- For refactors, get input from `blast-radius` and `safety-net`.

## Available subagents

| Agent | Delegate to it when |
|---|---|
| `surveyor` | First contact with a repo this session, before anything else. |
| `scope-sharpener` | Request lacks explicit acceptance criteria; scope is unclear. |
| `blast-radius` | Before editing shared, public, or unclear-ownership code. |
| `bug-detective` | Any bug report, before proposing a fix. |
| `perf-doctor` | Any performance report or "why is this slow", before fixing. |
| `skeptic` | Nontrivial plan exists; adversarial pre-build/pre-merge review. |
| `review` | Routine diff review before commit, or reviewing named files. Pre-commit: proactively offer a plannotator review (`plannotator-review`); large multi-file changesets: generate a `saga` walkthrough. |
| `advisor` | Plan-finalized and pre-commit checkpoints; skip silently if unavailable. |
| `qa` | After build: E2E-first scenarios, gates, diff scan. Before `safety-net`/`release-scribe`. |
| `safety-net` | Refactoring weak-coverage code, or finishing new nontrivial logic. |
| `sentinel` | Untrusted boundary: external input, auth, secrets, dependencies. |
| `release-scribe` | Before a PR or any nontrivial commit. |
| `foreman` | Cloud, IaC, CI/CD, or sysadmin work. |
| `scout` | External, library, or API behavior you cannot verify locally (pi builtin). |

## Delegation mechanics (pi-subagents-lite)

The delegation surface is three tools: `Agent` (params `prompt`, `description`,
`agent`, `run_in_background`, `worktree_path`), `AgentStatus`, `StopAgent`.
Agent types are the markdown files in `~/.pi/agent/agents/`; the `agent`
parameter is one of those names. `run_in_background: true` returns immediately -
check `AgentStatus` rather than blocking.

In an agent file, `tools:` must be a YAML **array** (`tools: [read, grep]`), not
a comma string; a comma string is ignored and the agent gets every tool.

Long-running shell work goes through `bg_run` (name it) plus `bg_logs`;
completion notifies the session, so do not poll.

## Treehouse worktrees

Agents work in isolated worktrees leased from a shared treehouse pool, so
parallel sessions never collide and your clone stays your workspace.
Treehouse is agent-exclusive - humans never run it; only the orchestrator ever
invokes `treehouse`. The committed `treehouse.toml` in each repo caps that
repo's pool at four worktrees cut from `develop`.

Before the first `treehouse get` in a repo, the orchestrator checks the repo
root for `treehouse.toml`. An existing `treehouse.toml` is left untouched - the
committed config always wins. A missing one is seeded as an uncommitted
working-tree file, never committed: `max_trees = 4` plus `base_branch =
"develop"` when `develop` exists (local branch or `origin/develop`),
`base_branch = "main"` when only `main` exists, and no `base_branch` line when
neither exists so treehouse infers the trunk.

Every repo-changing feature session runs inside one leased treehouse worktree,
shared by all subagents no matter how many are used:

    treehouse get -b feature/<slug> --lease --lease-holder pi-<session-slug> --json

- Only the orchestrator touches treehouse pool state. Subagents never invoke `treehouse`.
- The orchestrator passes the worktree's absolute path to every subagent; all of them work inside that one directory, not one worktree per lane.
- The lease persists across turns until the feature is done, then is re-acquired when the next repo change needs edits.
- Git repos only. When the session's directory is not a git repo, work directly in the cwd and skip treehouse.
- If treehouse cannot deliver a worktree (exit 1: pool exhausted, non-repo, binary missing), fail loud - report and ask the user, never fall back to the shared cwd silently.

When the feature is done:

    treehouse return <worktree-path> --if-lease-id <lease-id>

- If the worktree is dirty, first commit the remaining work on the feature branch, then return. Never use `--force` without the user's explicit approval.
- Returning releases the lease only. The orchestrator never merges the feature branch into the repo's main line - that is always the user's call.

## Asking

Always, no exceptions use the `ask_user_question` tool, use it for every
question instead of asking in plain text. Put your recommended answer in as one
of the options, and let the tool's own header/question/options display handle
formatting, don't add your own markdown or emoji on top of it.
If no `ask_user_question` tool is available, ask in plain text, one question at
a time, in whatever style the host already uses. Don't invent a custom template.

## Library and API docs

For any library, framework, SDK, or CLI documentation, load the `find-docs`
skill. Prefer it over web search and over answering from memory.

## .NET work

Prefer retrieval-led reasoning over pretraining: skim repo patterns -> consult
dotnet skills by name -> implement the smallest change -> note conflicts.

- Routing: C#/quality -> `modern-csharp-coding-standards`, `csharp-concurrency-patterns`, `api-design`, `type-design-performance`, `r3-reactive-extensions`; Web/Aspire -> `aspire-service-defaults`, `aspire-integration-testing`, `transactional-emails`; Data -> `efcore-patterns`, `database-performance`; DI/config -> `dependency-injection-patterns`, `microsoft-extensions-configuration`; Testing -> `testcontainers-integration-tests`, `playwright-blazor-testing`, `snapshot-testing`.
- Quality gates: `dotnet-slopwatch` after substantial new/refactored/LLM-authored code; `crap-analysis` after tests change in complex code.

## Token efficiency tools

Prefer deterministic CLI tools over naive shell commands. Highlights: `ast_grep`
over `grep`/`rg` for structural search, pi's native `find` tool for
gitignore-aware name searches and `fd` over `find` for complex/regex/multi-filter
queries (add `-H -I` for hidden/gitignored files), and `bg_run` + `bg_logs` for
commands over ~30s or that stream output instead of polling bash.

This stack does not ship pi-lens or billion-context. For symbol and call-path
exploration use `codegraph_explore`; for structural search use `ast_grep`; for
type and diagnostic checks run `tsc --noEmit` (or the repo's own lint/type
script) instead of an LSP tool. There is no in-session context compressor -
keep tool output compact yourself.
