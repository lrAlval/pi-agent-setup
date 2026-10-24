---
name: prp-plan
description: Compile a goals/<slug>/ package into the context packet pi plan mode consumes, so implementation never re-researches.
---

# prp-plan: compile pre-research into plan mode

Thin template. Turns a `goals/<slug>/` package (setup-goal fact sheet +
research findings) into the context packet pi plan mode consumes, so
implementation never re-researches.

## Input

- `goals/<slug>/facts.md` (interview fact sheet, source of truth)
- `goals/<slug>/research.md` (prior findings, if any)
- `specs/tech-stack.md` (stack constraints)

## Packet (paste into plan mode)

1. Goal in 2 sentences (from facts, not re-derived).
2. Scope in/out list (verbatim from fact sheet).
3. Decisions already taken (link `specs/decisions.md`, do not reopen).
4. Research findings with file/URL pointers (do not re-explore).
5. Suggested slice list (IDs only; slice-tasks owns the breakdown).

## Rules

- Max 40 non-blank lines. Pointers over prose.
- Anything missing -> mark UNKNOWN, never silently re-research.
- Render the resulting plan per the Plan Mode render rules in `config/AGENTS.md` (rich Markdown: tables, labeled blockquotes, and fenced code where useful).
