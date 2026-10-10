# Agent Instructions
These are common instructions for agents across all scenarios.

## General Guidelines
1. **Root cause over symptom** - reproduce before fixing; fix where all callers route through, not just the reported path.
2. **Quality over cost** - prefer simplicity, robustness, scalability, and long-term maintainability; development effort is not the deciding weight.
3. **Test intent and behavior** - assert outcomes, contracts, and user-visible behavior, not implementation structure; no implementation-mirroring tests, no exhaustive trivial-case suites, no coverage theater.
4. **Verify at the highest meaningful level** - reproduce bugs in an E2E-like setting first; hold UI work to pixel-level scrutiny.
5. **Raise the floor** - fix lint errors, test failures, flakiness, and visual defects you encounter, even when your change did not cause them.
6. **Token budget is a first-class constraint** - prefer compact, targeted output; batch operations to minimize round trips; filter and truncate instead of dumping raw content.
7. **Fail loud** - structured errors, explicit "0 results" over ambiguous empty output; never fail silently.
8. **Make one call do the work** - combine multi-step operations into single commands instead of confirm-then-observe cycles.
9. **Respect generated artifacts** - never hand-edit CHANGELOG.md or any file marked auto-generated.
10. **Clean commits, clean prose** - concise commit messages with no auto-added co-author; plain dash "-", never an em dash; one full sentence per line in long Markdown files.
11. **Short and concise** When reporting information to me, be extremely concise and sacrifice grammar for sake of concision.

## Memory

Persistent preferences, repeated corrections, and decisions with lasting consequences go through the `memory_add` / `memory_replace` tools (pi-hermes-memory) - not for one-off task details.
Wiki vault duties are handled by llm-wiki.

## Skill pointers (load on trigger, not every session)

- Delegating to a subagent, leasing a treehouse worktree, doing .NET work, or asking the user a question: load the `agent-routing` skill first.
- Any visual-interface work (UI, screen, page, dashboard, component, layout, design, theme, contrast, accessibility, frontend): load the `xias-routing` skill first - or `ui-sdlc` when the task spans requirements through shipping.
- Any structural code question (how X works, what calls what, where X is defined): load the `codegraph-usage` skill first.
