---
name: xias-routing
description: Load for any visual-interface work - UI, screen, page, dashboard, component, layout, design, theme, contrast, accessibility, frontend, prototype. Routes doctrine-first through the XIAS kit skill table, gate sets, and prototype exception.
---

# XIAS kit routing

The XIAS kit (ux-ui-agent-skills, pinned v2.9.6, cloned to `~/.agents/ux-ui-agent-skills`) is the spine for all UI work.

## Trigger

Any session touching a visual interface - designing, building, reviewing, restyling, or auditing pages, dashboards, components, diff viewers, forms, empty states, or themes.
Trigger words: UI, screen, page, dashboard, component, layout, design, theme, contrast, accessibility, "make it look", frontend.

## Route doctrine-first

Read the relevant skill before writing UI code, not after.
Load only the skills the task needs, never the whole kit.
The enforcer extension nudges the routing but the model does the reading.

| When | Skill (pi name) |
|---|---|
| Any UI work, always first | `design-doctrine` |
| New page / screen / site, end to end | `design-screen` |
| Dense data screen: dashboard, console, terminal, monitoring view | `data-dashboard` |
| Component spec (anatomy, variants, 8 states) | `design-component` |
| Component / screen code in a framework | `design-code` |
| Visual direction / brand feel / expensive look | `apply-aesthetic` |
| Before hardcoding any color, space, or type value | `design-tokens` then `token-build` |
| Product QA gates in CI | `design-qa` |
| Review / critique of finished work | `design-review`, then `/critique` |
| Accessibility questions | `a11y-audit` |
| Web performance / Core Web Vitals | `performance` |
| UI copy, errors, empty states | `ux-writing` |
| Figma token / component sync | `figma-integration` |
| Quick throwaway prototype / sanity check / mockup | `prototype` (user-invoked) - cheap gates only |

## Command-only skills

User-invoked, never model-loaded: `/brandkit` `/governance` `/image-to-code` `/migrate-design-system` `/prototype` `/redesign` `/gate` `/critique` `/grill-me` `/ship` `/scaffold-project`.

## Pattern

Doctrine -> route by artifact -> tokens before any hardcoded value -> build -> gate set -> adversarial critique and explicit dispositions for real or production UI.

## Rigor by artifact maturity

A throwaway prototype earns doctrine plus the cheap short gate pair (see the exception below), with skipped render gates logged as deliberate tradeoffs.
Real or production UI earns the applicable gate set from the kit's `docs/GUIDE.md` and `docs/AGENTS-SETUP.md`, including browser render gates and a critique pass, and every finding is either fixed or explicitly dispositioned.
Do not skip a gate silently.

## Throwaway-prototype exception

When the user explicitly frames the work as a throwaway prototype, quick mock, or sanity check, or runs `/prototype`, the requirement drops to the cheap short gate pair - `lint_hardcodes.py` plus `check_no_emoji.py`, with `validate_contrast.py` added when tokens were used.
No render or browser gates and no critique pass; log the skipped render gates in one line as a deliberate tradeoff.
The moment the user promotes the prototype to real or production UI ("production", "ship it", "make it real", "build it properly"), the full gate set applies again.

## Gate sets

Cheap gates: `validate_tokens.py`, `validate_contrast.py`, `lint_hardcodes.py`, `check_no_emoji.py`, `lint_native_select.py`, `validate_theme_refs.py`, `validate_component_spec.py`, `lint_taste.py`.
Render gates (need Playwright or Chrome): `measure_render.mjs` in light and dark, `verify_states.mjs`, `axe_audit.mjs`, `verify_responsive.mjs`, `verify_interactive.mjs`, `verify_keyboard.mjs`, `verify_target_size.mjs`, `verify_mobile_first.mjs`, `verify_focustrap.mjs`, `verify_overflow.mjs`, `verify_reduced_motion.mjs`, `verify_rtl.mjs`, `verify_screen_economy.mjs`, `lint_intent.mjs`, `slop_tells.mjs`, `taste_audit.mjs`.
Prefix a single render gate with `DS_REQUIRE_BROWSER=1` so a `SKIPPED` result fails loudly instead of reading as a pass.

## Polish route

When the task is aesthetics, redesign, polish, motion, premium look, or live browser iteration, route to the `impeccable` skill for that phase.
The orchestrator (`ui-sdlc`) chooses per task: XIAS kit is the spine (doctrine, tokens, gates, component specs), `impeccable` is the polish route.
Never load both blindly.

## Naming note

Pi invokes skills by bare frontmatter name (`/skill:data-dashboard`, `/skill:design-screen`); the `xias-` prefix is only the symlink path under `~/.agents/skills/`, so `xias-data-dashboard` resolves to the `data-dashboard` skill.
Kit-internal cross-references use the bare names.

## Location

The kit is cloned to `~/.agents/ux-ui-agent-skills`, pinned to the v2.9.6 release tag, with each skill exposed to pi as `~/.agents/skills/xias-<name>`.
Skills reference kit-relative paths, so resolve `${CLAUDE_SKILL_DIR}` to the loaded skill's own directory.

## Scope of measurement

The kit's automated gates check objective correctness - token drift, contrast, accessibility, structure.
They do not judge taste, so a human or agent design-review pass is still required before calling UI work done.
