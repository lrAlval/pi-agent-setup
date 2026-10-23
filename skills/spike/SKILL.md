---
name: spike
description: Close a specific technical uncertainty with a scoped throwaway probe. Use when brainstorm leaves validation-only gaps, or when asked to spike/prototype-to-learn. Never plans or writes product code. Records findings into the feature wiki chain.
---

# Spike — validate the unknown, ship nothing

A spike answers questions only validation closes. If a decision (not an
experiment) closes it, no spike: decide and record a `decision` page instead.

## Procedure

1. **Frame.** Name each uncertainty + the cheapest probe that closes it +
   what "closed" looks like (observable outcome, not a feeling).
2. **Scope the probe.** Throwaway by design: timebox, files touched, no
   product-code plan, no migration, no polish. Reuse codegraph evidence from
   the brainstorm page.
3. **Run.** Build the probe, record raw findings (commands, outputs, numbers).
4. **Recompute uncertainty.** Exit by re-evaluating what remains: list each
   original gap as closed (evidence) or still open (why + next probe or
   decision needed). This step is mandatory, not ceremonial.
5. **Persist.** `wiki_ensure_page` type `spike`, linked from the feature's
   brainstorm page. Findings, not narrative.
6. **Hand off.** Emit ESON lane-report (format per `impl-lifecycle`), then
   end the turn with an approval card.

## Approval card

`ask_user_question` (normal) or `plan_mode_question` (plan): approve & continue (→ `impl-lifecycle` routes onward) / revise / stop.

## Pitfalls

- Probe creeping into product code; throwaway means throwaway.
- "Spike" used to dodge a decision; decisions need decision pages, not code.
- Findings left in chat; the wiki chain is the memory.

