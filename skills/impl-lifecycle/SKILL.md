---
name: impl-lifecycle
description: "Route the enforced idea-to-plan lifecycle: brainstorm, then spike only if uncertainty remains, then plan-implementation. Use after brainstorm completes, or when asked to run the lifecycle. Owns per-iteration approval cards and the ESON handoff format. Nothing proceeds unapproved."
---

# Impl-lifecycle — the router

Enforced order: `brainstorm` → (`spike`)? → `plan-implementation` →
approved implementation. Wiki persistence + approval card at every stage.

## Lifecycle boundary

This skill routes only the separate `brainstorm` → (`spike`)? →
`plan-implementation` idea lifecycle. Plan Mode has its own phases and stop-gates,
defined in `AGENTS.md`; do not apply this skill's handoff rules to `/plan`.

## Routing rule

After brainstorm completes, evaluate remaining uncertainty:

- Gap closable only by validation (experiment, measurement, probe) →
  enforce `spike`, stating reasons.
- Gap closable by decision, or no gaps → suggest `plan-implementation`
  directly, stating why no spike is needed.

After spike, recompute: still-open validation gaps → another scoped spike
(say why); else → `plan-implementation`.

## Approval cards (owned by this skill)

After every stage output and every plan revision, end the turn with
`ask_user_question` (normal mode) or `plan_mode_question` (plan mode):
approve & continue / revise / stop. Nothing proceeds unapproved.
Human review: wiki pages readable manually anytime; cards gate progression.

## ESON handoff encoding (all lifecycle skills + lanes)

ESON: one fact per line, `key:value`, no prose. Envelope every report opens
with (values terse, `;`-separated lists, `[[wikilink]]` for pages):

```
ESON|skill:<brainstorm|spike|plan-implementation|lane>|feature:<slug>|date:<ISO>
scope:<one line>
decisions:<d1;d2>
open:<u1;u2>
links:<[[page1]];[[page2]]>
```

Lanes consume ESON context and return ESON reports; lane outputs fold into
plan revisions. Lane rule: at most 3 non-overlapping file sets (each file in
exactly one lane); lanes run muse:low and self-verify; orchestrator
integrates and runs the full test suite once after all lanes report.

## Observability

Stage transitions + plan revisions flow through `pi-observability-plugin`;
optional Langfuse push when keys configured. Never required for function.

## Pitfalls

- Skipping spike when validation gaps are real; name the reason either way.
- Parallel stages; the lifecycle is sequential, lanes parallelize only
  approved implementation.
- Prose handoffs; ESON or it did not happen.
