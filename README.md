# pi-agent-setup

Vanilla pi gives you a model and tools.
This repo turns it into an opinionated stack: tuned config, a 26-package extension set plus 6 local extensions, 13 subagents, 47 vendored skills plus the XIAS UI kit, enforced routing and gates, persistent memory, and a token-efficiency strategy - all installed with one line.

```bash
curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex
```

Re-running is always safe: the installer is strictly idempotent (see Installer guarantees).
Windows is supported best-effort; the stack is WSL-first.

## The opinionated extension stack

| Extension | What it is | Problem it solves |
|---|---|---|
| `pi-rtk-optimizer` | Tool-output compaction + savings tracking | Raw tool output floods context; rewrites and truncates it, tracks savings |
| `@gotgenes/pi-permission-system` | Permission gate for destructive/secret paths | One wrong `rm -rf` or secret read ruins a session; risky patterns ask or deny |
| `local-bash` | Denylist shell + bwrap sandbox lane (local, this repo) | Plan-mode blocks all mutation including scratch self-tests; command-position matching kills false positives, `reviewScratch` allows /tmp writes, `sandbox:true` runs installs/self-tests contained |
| `better-plan-mode` (vendored in `pi/packages/`, fork of `@narumitw/pi-plan-mode`) | Truly read-only plan mode | Stock plan mode leaks write paths and has no lifecycle handoff; the fork carries the reviewed read-only policy, `bashMode: "yolo"`, and the auto fresh-implementation handoff natively, so no install-time patch is needed |
| `pi-hermes-memory` + `pi-observational-memory` | Persistent memory across sessions | Every session starts from zero; recall budgets replace re-discovery |
| `pi-subagents-lite` + 13 agents in `pi/agents/` | Isolated subagent delegation | Single-agent sessions waste context on exploration; delegates run isolated |
| `ponytail` + footer widget | Cost/savings footer | Spend is invisible; the footer shows it live |
| `pi-caveman` | Response compression (~75%) | Verbose answers burn tokens; caveman mode compresses them |
| `@zosmaai/pi-llm-wiki` | Interlinked markdown wiki | Decisions evaporate; the wiki keeps them searchable |
| `@henryqw/pi-codegraph` | Structural code exploration | Grep-and-read loops burn context; one query returns symbols plus call paths |
| `pi-smart-fetch` | Browser-grade fetching | Naive curl fails on real sites; smart fetch renders readable content |
| `pi-ast-grep` | Syntax-aware search | Text grep false-positives; structural patterns match code, not strings |
| `pi-mcp-adapter` | MCP server gateway | External tools need a bridge; the adapter provides it |
| `efficient-pi-ask-user` (local fork of `@juicesharp/rpiv-ask-user-question`, see `FORK_OVERRIDES.md`) | Structured questions | Plain-text questions get vague answers; options force decisions |
| `@juicesharp/rpiv-todo` | Session task tracking | Long tasks lose state; the todo list holds it |
| `pi-background-tasks` | Background shell + agents | Long commands block; background runs notify on completion |
| `@plannotator/pi-extension` | Plan annotation and review | Plans rot; annotation keeps them current |
| `pi-footer` | Status bar (branch, model, ponytail) | Blind sessions; the footer shows where you are |
| `@henryqw/pi-undo` | Undo for agent edits | Bad edits stick; undo reverses them |
| `pi-hide-providers` | Provider allowlist | Dozens of providers clutter routing; hidden ones stay out |
| `@vigolium/piolium` | Extra pi tooling | Niche workflows need niche tools |
| `pi-observability-plugin` (vendored in `pi/packages/`, Langfuse upstream) | Run observability | Sessions are opaque; traces show what happened |
| `git:pi-community-themes` | Theme pack | Stock theme only; `atom-one-dark` and friends |
| `pi-eta` (vendored in `pi/packages/`) | Live ETA from your todo list | Estimates drift silently; progress widget plus countdown plus calibration |
| `local-bash` (local) | Guarded shell presets | Ad-hoc shell flags vary; pinned prefixes, timeouts, output caps |
| `local-patch-guard` (local) | Patch-chain watchdog | Patched packages update silently; re-applies the remaining registry entries at session start |
| `spine-enforcer` (local) | Spine repo discipline | Goal/spec/state files rot; enforces the spine contract |
| `token-trail` (local) | Token spend trail | Spend is invisible per turn; records the trail |
| `pi-codemode-toggle` | Codemode switch | Codemode always-on constrains; toggle per need |
| `@davecodes/pi-dcp` | Dynamic context pruning | Long sessions fill context; mechanical pruning keeps them cheap |
| `@barlevalon/thermo-nuclear-code-quality-review-skill` | Review skill | Reviews stay shallow; nuclear-grade depth on demand |

## Token efficiency

The savings compound: tool-output compaction (rtk `trackSavings`), response compression (caveman ~75%), memory over re-discovery (tuned recall budgets), one-query structural exploration (codegraph/ast-grep), subagent and background isolation, blackhole mid-run folding, flash-tier model routing per mode with pinned thinking levels, thin-pointer AGENTS.md (~70% every-session context cut vs the old 7.7K file), skills-on-trigger instead of always-loaded.
Visible counters: the footer ponytail widget plus rtk `trackSavings`.

## Skills and rules architecture

- `skills/` holds 47 vendored skill dirs (including `impeccable` v4.2.2, vendored whole with `scripts/`, `reference/`, `agents/` so its context launcher works offline). The 25 `xias-*` kit skills are symlinks recreated by the installer from `skills/xias-symlinks.txt`, pointing into the `ux-ui-agent-skills` clone (v2.9.6).
- `pi/AGENTS.md` is a thin pointer: General Guidelines stay inline (cheap, every session), plus Asking / Delegation / Treehouse / Token-efficiency sections; everything else is a pointer. Three layers:
  - Prose (AGENTS.md): always-loaded rules, token-cheap.
  - Skills (`pi/skills/`): `agent-routing` (delegation, worktrees, .NET, asking), `xias-routing` (full XIAS doctrine, routing table, gate sets, prototype exception), `codegraph-usage` (structural exploration rules), `ui-sdlc` (full-SDLC orchestrator). Loaded on trigger, not every session.
  - Enforcer (`pi/extensions/xias-enforcer/`): the backstop. One-time nudges, refuse-to-settle once per mode, read-only, never loops. (The `rules-enforcer` experiment was retired; live runs `xias-enforcer`.)
- `ui-sdlc` flow (7 phases): Intent (`ask_user_question` -> `to-prd` -> `to-issues`) -> Design (doctrine-first, artifact routing, tokens before hardcodes) -> Build (`design-code`/`design-screen`) -> Gates (cheap always, render for real UI) -> Review (`design-review` + `/critique`, every finding fixed or dispositioned) -> Validate (`no-mistakes` pipeline) -> Deliver (push + `gh pr create`, PR left open). XIAS kit is the spine; `impeccable` is the polish route. The orchestrator chooses per task, never loads both blindly.

## Installer guarantees

Safe to re-run anytime.
The contract, in user terms:

- Never reinstalls what exists: `pi`, `fd`, `treehouse` are detected and reused. Tool upgrades need `--upgrade` explicitly; a newer installed version is never downgraded.
- Never deletes your files: unmanaged files in `~/.pi/agent` are listed and left alone. `auth.json` and `trust.json` are excluded from sync unconditionally.
- Minimal writes: `manifest.lock` carries sha256 of every managed file; only drifted files are copied (atomic temp-then-move). A clean re-run reports `up-to-date, 0 files changed` and writes nothing.
- Atomic and concurrency-safe: temp-then-`mv` everywhere, `flock` lock, second concurrent run exits with "already running".
- One backup: first run with a pre-existing `~/.pi/agent` makes one timestamped backup; re-runs never back up again.
- Fast path: unchanged manifest fingerprint plus passing verification prints `already installed (manifest <hash>), nothing to do`.
- `--force` is the only way to force re-downloads and resets; nothing implicit ever does.

## What is NOT in the repo

| Excluded | Why |
|---|---|
| `auth.json`, `trust.json`, provider keys | Secrets never touch git |
| `sessions/`, `sessions.db*`, sqlite WAL/locks | Runtime state, machine-local |
| `pi-usage.json`, `mcp-cache.json`, `mcp-onboarding.json`, `last-seen-version.json`, `-pending.json` | Ephemeral caches |
| `install/` (486 MB), `npm/` (1.8 GB), `bin/` | Reinstalled by the installer / `pi` itself |
| `pi-hermes-memory/sessions.db*`, `projects-memory/` DB state | Binary state; text memory ships under `memory/` |
| `~/.agents/ux-ui-agent-skills/` | Public clone (`plugin87/ux-ui-agent-skills`); the installer clones it |
| `pi/packages/*/node_modules`, `pnpm-lock.yaml` | Installed by the installer (`npm install --omit=dev`), never committed |

## Agent self-tests (sandbox lane)

Installer changes verify in a scratch HOME under `bwrap`, never the live one.
The recipe: `T=$(mktemp -d)` plus `PI_SETUP_REPO_DIR=<repo> PI_SETUP_SKIP_PI_INSTALL=1 HOME=$T bash install.sh` with `sandbox:true`.
The second run must be all-SKIP (`already installed ... nothing to do`).
Config lives in `local-bash.json` (`reviewScratch`, `sandboxAllowFallback`, `sandbox.allowNetwork`, all default off).
Unit tests: `bun test --preload pi/extensions/local-bash/typebox-stub.ts pi/extensions/local-bash/index.test.ts`.

## Regular syncs from live

`sync-from-live.sh` vendors the vetted delta from live `~/.pi/agent` back into `pi/` + `skills/`, excluding vanilla-pi stock.
Baseline is the stock file list from the `tool:pi` tarball pin in `manifest.lock` (shasum-verified); fallback is the local npm `pi-coding-agent` install, else warn and continue.
Modes: default dry-run (no writes); `--check` explicit dry-run without prompts; `--apply` writes + regenerates `manifest.lock` + lints `install.sh`; `--yes` non-interactive, unknowns append to mktemp pending file (`$SYNC_PENDING_FILE` or `/tmp/sync-pending.XXXXXX`, replaces old `sync-pending.conf` flow); `--json` machine output; `--strict` abort on secret; `--verify` checksum `manifest.lock`.
Classes: `runtime` skip (sessions/db/locks/logs/cache), `secret` skip (auth/trust/keys/tokens), `stock` skip (in baseline), `npm-package` baseline source, `conf-rule` (`SKIP_ALWAYS`/`VENDOR_ALWAYS` hit), `unknown` prompt/pending.
`sync-classify.conf` persists decisions: `RUNTIME_PATTERNS`, `SECRET_PATTERNS`, `SKIP_ALWAYS`, `VENDOR_ALWAYS`, `SKILL_SOURCES`, `TRANSFORMS`, `MEMORY_MODE`.
Policy: live wins except repo-newer guard skips when repo copy is newer; `memory/` never vendored; secrets never vendored; deletions report-only (`REVIEW-DELETE`, never deletes).
Cadence: run after live hotfixes drift from repo; land via PR only, never direct to `main`.

## Manual steps after install

1. Provider auth: run `pi` and authenticate. Credentials stay on your machine, never in this repo.
2. Plan mode needs no patch step: `pi/packages/better-plan-mode` is vendored source and carries the reviewed read-only policy, `bashMode`, and the auto-implementation handoff natively. Re-vendor it from the fork checkout after fork changes (copy `src/`, `docs/`, `README.md`, and `LICENSE`, then flip `.js` import specifiers to `.ts`; the vendored directory is source-only, so fork tests stay in the fork checkout).
3. After any pi package update, re-run the codemode-content guard and its verifier: `node ~/.pi/agent/patches/fix-codemode-content.mjs && node ~/.pi/agent/patches/verify-codemode-content.mjs`.
4. Do not commit secrets into `memory/` later; it is shared content, not a vault.

## Layout

```
pi/                -> ~/.pi/agent/ (settings.json, config.yml, AGENTS.md, agents/,
                      extensions/, packages/, patches/, scripts/, skills/,
                      plugin configs: caveman/pi-plan-mode/efficient-pi-ask-user/
                      local-bash/hide-providers *.json)
skills/            -> ~/.agents/skills/ (47 vendored dirs; xias-* recreated as symlinks)
memory/            -> hermes/projects memory content (no binary state)
manifest.lock      determinism source: tool pins + sha256 of every managed file
install.sh         bash/macOS/Linux one-liner target
install.ps1        Windows PowerShell twin
```
