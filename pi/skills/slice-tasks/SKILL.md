---
name: slice-tasks
description: Break a goals/<slug>/ package into vertical backlog slices with acceptance criteria. Use when a goal package exists and execution tasks are needed.
---

# Slice tasks

Read the goal package. Write execution slices. Never re-interview: UNKNOWN stays UNKNOWN and becomes the first slice's question.

## Input

- `goals/<slug>/facts.md` (scope, success criteria)
- `specs/tech-stack.md` (constraints)

## Rules

- Vertical (tracer-bullet) slices: each cuts all layers, demoable alone. Thin beats thick.
- Each slice -> `backlog/<id>-<kebab>.md` with frontmatter `id, goal, status: todo, slice: HITL|AFK, blocked-by: []` plus `## Acceptance` (checkboxes, observable behavior only).
- Order by dependency; mark HITL where human judgment blocks.
- Tracker sync (opt-in per repo): if repo uses GitHub issues, mirror each slice as an issue (URL in frontmatter, task path in issue body). Backlog files stay source of truth; `to-issues` remains the tracker-first alternative.
- Light epics (convention, not a skill): for multi-slice efforts write `specs/epics/<id>.md` (goal + slice IDs + status frontmatter). Visualize as Archify dependency diagram. Tracker-native huge efforts stay on wayfinder.
- End: update `specs/state.yaml` current slice + todo list.
