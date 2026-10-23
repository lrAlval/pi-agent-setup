---
name: brainstorm
description: Shape a new feature or idea before any implementation planning. Use when the user proposes a feature, asks to explore an idea, or says "brainstorm". Produces a high-level overview plus a brainstorm wiki page, ends with an approval card. Not for bugfixes or fully-specified tasks.
---

# Brainstorm — shape the idea, plan nothing yet

Output: high-level overview + `brainstorm`-type wiki page. No file maps, no
signatures, no implementation plan. That belongs to `plan-implementation`.

## Procedure

1. **First-principles round.** Restate the problem without the proposed
   solution. What changes for whom? What is explicitly out of scope?
2. **Trade-off round.** List 2-4 candidate approaches with cost, risk,
   reversibility. Compose `grilling` for adversarial questions and `zoom-out`
   against the existing architecture.
3. **Stack round.** Check OPINIONS.md (global + project deviations win) and
   compose `research` / `find-docs` for current external API/docs facts.
   Never rely on training data for API details.
4. **Code exploration (mandatory).** Run `codegraph_explore` on every touched
   area. Cite evidence (file:line/symbol) for each claim about current behavior.
   No exploration = no brainstorm output.
5. **Overview.** Write the converged shape: goal, approaches compared,
   recommendation with reasons, open uncertainties (each labeled with what
   would close it: validation vs decision).
6. **Persist.** `wiki_ensure_page` type `brainstorm`, link related
   `decision` pages for each judgment call. Cross-link the feature chain.
7. **Hand off.** Emit ESON lane-report (format per `impl-lifecycle`), then
   end the turn with an approval card.

## Approval card

`ask_user_question` (normal mode) or `plan_mode_question` (plan mode):
approve & continue (→ `impl-lifecycle` routes to spike or
plan-implementation) / revise / stop. Nothing proceeds unapproved.

## Pitfalls

- Drifting into implementation detail; push it to plan-implementation.
- Uncited claims about current code; every claim needs codegraph evidence.
- Skipping the wiki page; the chain starts here.

