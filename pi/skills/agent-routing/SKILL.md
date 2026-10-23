---
name: agent-routing
description: Route delegation, worktrees, lanes, dotnet, or token-tool questions to the right granular skill. Load before spawning subagents, leasing worktrees, or .NET work.
---

# Agent routing (router)

Thin orchestrator. Route, then load the target skill. No mechanics live here.

| Concern | Skill |
|---|---|
| Delegate to subagents, fork vs bg_delegate vs Agent | `subagent-delegation` |
| Lease/return treehouse worktrees, PR-ending contract | `treehouse-worktrees` |
| Parallel implementation lanes | `impl-lanes` |
| .NET skills, quality gates | `dotnet-routing` |
| ast_grep/fd/rtk/bg_run/codegraph tooling | `token-tools` |
| Asking the user | AGENTS.md Asking section (single source of truth) |
| Library/API docs | `find-docs` skill |

## Non-negotiables

- Never propose a bug fix before `bug-detective`.
- Never edit shared, public, or unfamiliar-ownership code before `blast-radius`.
- Never suggest infrastructure changes before `foreman`.
- On first contact with a repo this session, delegate discovery to `surveyor` before anything else.
- For refactors, get input from `blast-radius` and `safety-net`.
