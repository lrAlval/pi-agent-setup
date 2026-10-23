---
name: impl-lifecycle
description: "Route the enforced idea-to-plan lifecycle: brainstorm, then spike only if uncertainty remains, then plan-implementation. Use after brainstorm completes, or when asked to run the lifecycle. Owns per-iteration approval cards and the ESON handoff format. Nothing proceeds unapproved."
---

# Impl-lifecycle — the router

Enforced order: `brainstorm` → (`spike`)? → `plan-implementation` →
approved implementation. Wiki persistence + approval card at every stage.

## Continuous-run rule (pi-plan-mode fork)

The `better-plan-mode` fork drives the handoff automatically, so the lifecycle
runs without an extra turn between stages:

- The brainstorm approval card is the ONE gate. On approve, do NOT end the turn
  to ask permission again; immediately continue with `spike` (when uncertainty
  remains) or `plan-implementation` in the same turn.
- In `/plan` mode the approved plan-end is `plan_mode_complete`; with
  `autoImplement: "fresh"` (live at `~/.pi/agent/pi-plan-mode.json`) the
  extension then starts the linked fresh implementation session itself, using
  the resolved implementation runtime (first available
  `implementationModelPresets` entry, here `muse`/medium). Never start a second
  implementation yourself after `plan_mode_complete`; the extension owns it.
- Without interactive UI (`pi -p`), the automatic handoff does not run: the plan
  stays ready and a notification reports it.

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
