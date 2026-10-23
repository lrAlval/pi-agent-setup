---
name: plan-implementation
description: Turn a shaped idea into a COMPLETE implementation spec with zero ambiguity. Use when brainstorm (and any spikes) are approved, or when asked to plan implementation. Emits all 6 required sections plus self-audit, persists a revision-logged wiki page, ends with an approval card. No code until approved.
---

# Plan-implementation — the complete spec channel

Target: zero ambiguity. A competent implementer with no extra context
executes the plan without asking questions.

## Required sections (every revision, no exceptions)

1. **Goal & scope.** Behavior changes, in/out of scope, public
   API/interface/type changes.
2. **File map.** Every file created / modified / deleted, with paths.
3. **Symbol contract spec.** Per new/changed function, class, endpoint:
   exact name, signature, parameter and return shapes, error modes; data
   flow; inter-service/module interaction (call paths); dependency additions
   with versions and rationale.
4. **Edge cases & failure modes.** Boundary inputs, error propagation,
   concurrency/migration considerations, compatibility constraints.
5. **Test plan (first-class, not an appendix).** Per acceptance criterion,
   which test proves it; test-type ladder (highest meaningful level first:
   E2E/integration, unit only at seams); TDD red-green seams per contract;
   F.I.R.S.T quality; exact verification commands; explicit NOT-testable
   statement with reasons.
6. **Assumptions & defaults.** Every decision made without user input, named.

## Self-audit (before presenting)

Run the `audit-plan` rubric (ported from bigpowers, baked in here):

- **A**cceptance: every criterion has a proving test + command. None → fail.
- **U**nits at seams only: no implementation-mirroring or coverage theater.
- **D**ependencies pinned: name + version + rationale per addition.
- **I**nterfaces exact: signatures/params/returns/errors per symbol.
- **T**ype ladder: E2E/integration before unit; level stated per test.

Plus the section checklist: missing section = not ready for approval.
Fix or explicitly scope out; never silently skip.

## Procedure

1. Gather inputs: brainstorm page, spike pages, lane ESON reports if any.
2. Draft all 6 sections with codegraph-cited evidence.
3. Self-audit per rubric; rework until clean.
4. Persist: `wiki_ensure_page` type `implementation-plan`. Every revision
   appended to its dated revision log (date, what changed, why, triggering
   skill). Never rewrite history.
5. Emit ESON lane-report, end turn with approval card per revision.

## Approval card

`ask_user_question` (normal) or `plan_mode_question` (plan): approve & continue (→ implement per the plan) / revise / stop. No code before approval.

## Pitfalls

- Test plan as appendix; it is section 5, first-class.
- Vague symbols ("a helper", "the service"); exact names or not ready.
- Unstated assumptions; name every default you chose.

