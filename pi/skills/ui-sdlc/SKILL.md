---
name: ui-sdlc
description: Automate the full UI SDLC - requirements through shipping - inside one leased treehouse worktree. Delegates per phase to existing skills and subagents on the XIAS-kit spine with impeccable as the polish route. Load when a UI task spans intent to PR.
---

# ui-sdlc: full-SDLC UI orchestrator

One skill automating the entire UI SDLC.
It sequences and delegates - it never duplicates kit content.
Run the whole cycle inside one leased treehouse worktree.

Division of labor (locked): the XIAS kit is the spine (doctrine, tokens, gates, component specs); `impeccable` is the route for polish, aesthetics, redesign, motion, and premium-feel work.
The orchestrator chooses per task, never loads both blindly.

## 0. Worktree

Lease one treehouse worktree for the whole cycle (see `agent-routing` for the policy):

```
treehouse get -b feature/<slug> --lease --lease-holder pi-<session-slug> --json
```

Pass the worktree path to every subagent.
Commit before returning; never merge - merging is the user's call.

## 1. Intent

Capture requirements with `ask_user_question` (via the `agent-routing` asking rules).
Persist a PRD via `to-prd`.
Break into tracker issues via `to-issues` when the work exceeds one session (fall back to `wayfinder` for wayfinding-scale efforts).

## 2. Design

Read `design-doctrine` first.
Route by artifact through the `xias-routing` table (`design-screen`, `data-dashboard`, `design-component`, ...).
Route to `impeccable` when the task is aesthetics, redesign, polish, motion, premium look, or live browser iteration.
Lock the visual direction.
Resolve tokens with `design-tokens` then `token-build` before any hardcoded value.

The orchestrator holds these rules across the phase: one shared theme, eight states per component, output completeness.

## 3. Build

Implement via `design-code` (framework code) or `design-screen`.
Keep the one-shared-theme, eight-states, and output-completeness rules held from the design phase.

## 4. Gates

Run the applicable gate set from `design-qa`: cheap gates always; render gates (Playwright/Chrome) for real UI with `DS_REQUIRE_BROWSER=1` on any single-gate run.
Prototype mode uses the cheap pair (`lint_hardcodes.py` + `check_no_emoji.py`, plus `validate_contrast.py` when tokens were used) with skipped render gates logged in one line as a deliberate tradeoff.
The `rules-enforcer` extension refuses to let the session settle without the mode's gate set.

## 5. Review

Adversarial pass: `design-review` plus `/critique`.
Every finding is fixed or explicitly dispositioned. `a11y-audit` for WCAG criteria, `performance` for Core Web Vitals, `ux-writing` for UI copy, errors, and empty states.

## 6. Validate and ship

Run the `no-mistakes` pipeline (code review, tests, lint, docs) before push.
Fix or disposition every finding.

## 7. Deliver

Push the feature branch and open a PR with `gh pr create`: summarize gates run, critique dispositions, and verification evidence.
Leave the PR open for human review - do not merge.
