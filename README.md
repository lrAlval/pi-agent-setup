# pi-agent-setup

Vanilla pi gives you a model and tools.
This repo turns it into an opinionated stack: tuned config, a 27-package extension set plus 6 local extensions, 13 subagents, 47 vendored skills plus the XIAS UI kit, enforced routing and gates, persistent memory, and a token-efficiency strategy - all installed with one line.

```bash
curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex
```

Re-running is always safe: the installer is strictly idempotent (see Installer guarantees).
Windows is supported best-effort; the stack is WSL-first.

## Extensions

Grouped by workflow. Package sources live under `pi/packages/` or `custom-extensions/`; settings and install metadata live under `pi/` and `manifest.lock`.

### Safety and control

- [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system) - gates destructive commands and sensitive paths.
- [`local-bash`](pi/extensions/local-bash/) - denylist shell and bwrap sandbox lane, including contained scratch tests.
- [`better-plan-mode`](pi/packages/better-plan-mode/) - read-only planning plus reviewed lifecycle handoff.
- [`pi-hide-providers`](pi/extensions/) - provider allowlist keeps routing focused.

### Context and memory

- [`pi-rtk-optimizer`](pi/extensions/) - compacts tool output and tracks savings.
- [`pi-hermes-memory`](pi/extensions/) + `pi-observational-memory` - persist and recall useful session context.
- [`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) - interlinked Markdown knowledge base.
- [`@henryqw/pi-codegraph`](https://github.com/henryqw/pi-codegraph) + `pi-ast-grep` - structural code search and syntax-aware matching.
- [`pi-smart-fetch`](https://github.com/earendil-works/pi-smart-fetch) + `pi-mcp-adapter` - readable web fetch and MCP connectivity.
- [`@davecodes/pi-dcp`](https://github.com/davecodes/pi-dcp) - prunes stale context.

### Planning and execution

- [`pi-subagents-lite`](pi/agents/) + 13 agents - isolated delegation.
- [`git:pi-fork`](https://github.com/earendil-works/pi-fork) - branch-aware child sessions with structured reports.
- [`efficient-pi-ask-user`](pi/extensions/efficient-pi-ask-user/FORK_OVERRIDES.md) - structured decisions instead of vague free-text prompts.
- [`pi-todo-eta`](custom-extensions/pi-todo-eta/) - SQLite-backed todos, ETA, progress widget, and estimate calibration.
- [`pi-background-tasks`](https://github.com/earendil-works/pi-background-tasks) - long-running shell jobs and agents.
- [`@plannotator/pi-extension`](https://github.com/Plannotator/extension) - plan annotation and review.

### Visibility and recovery

- [`ponytail`](https://github.com/dietrichgebert/ponytail) + [`pi-footer`](pi/extensions/) - live spend, savings, branch, and model status.
- [`@henryqw/pi-undo`](https://github.com/henryqw/pi-undo) - reverses agent edits.
- [`pi-observability-plugin`](pi/packages/pi-observability-plugin/) - Langfuse-backed run traces.
- [`git:pi-community-themes`](https://github.com/Agent-Field/pi-community-themes) - additional terminal themes.
- [`@vigolium/piolium`](https://github.com/vigolium/piolium) - extra Pi tooling.

### Local workflow helpers

- [`local-patch-guard`](pi/extensions/local-patch-guard/) - reapplies registered patches and preserves machine-local entries.
- [`spine-enforcer`](pi/extensions/spine-enforcer/) - enforces repo goal/spec/state conventions.
- [`token-trail`](pi/extensions/token-trail/) - records per-turn token spend.
- [`pi-codemode-toggle`](pi/extensions/) - toggles codemode when needed.
- [`pi-caveman`](https://github.com/earendil-works/pi-caveman) - compresses responses for token efficiency.


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

## CI (verify workflow)

`.github/workflows/verify.yml` runs on every PR to `main` and on pushes to `main`.
Checks: `bash -n` on `install.sh` and `sync-from-live.sh`, sourcing `sync-classify.conf`, `install.ps1` parse (skipped when `pwsh` is absent), every tracked `pi/**/*.json` parses, `manifest.lock` matches a fresh checksum walk of `pi/` + `custom-extensions/` + `memory/` + `skills/`, and vendored/local packages stay source-only (no `node_modules/` or `dist/`, `pi.extensions` points at `./src/index.ts`, no `.js` import specifiers).
It also scans every tracked file under `pi/`, `custom-extensions/`, `memory/` and `skills/` for secret patterns and fails on a match, because this repository is public while `sync-from-live.sh` vendors live configuration automatically.

### What syncs

`extensions/*` is vendored wholesale, so any new local extension lands here on the next sync; `themes/*` and `subagents-lite.json` are vendored too.
Runtime state stays live-only by policy (`RUNTIME_PATTERNS`): sessions, `npm/`, `git/`, `bin/`, `install/`, `logs/`, `extensions/*/logs/*`, `plans/`, `archive/`, `skill-audit/`, `projects-memory/`, `pi-hermes-memory/`, `models-store.json`, and the MCP caches.
`SECRET_PATTERNS` (auth, trust, keys, tokens) are never read or copied.
Run the same checks locally before pushing: regenerate with `head -n 6 manifest.lock > /tmp/m && (find pi custom-extensions memory skills -type f | grep -v 'skills/xias-symlinks.txt' | sort | xargs sha256sum | sed 's| \./|  |') >> /tmp/m && mv /tmp/m manifest.lock`.

## Patches

`pi/patches/patch-registry.json` lists the re-appliable patches the local-patch-guard extension runs at session start (it re-applies a step only when its marker is absent, so it is idempotent).

- Shipped: `omp-theme-plan-complete` for `@nguyenquangthai/pi-omp-theme` - `apply-omp-theme-plan-complete.mjs` plus `verify-omp-theme-plan-complete.mjs` and `pi-omp-theme-plan-complete-result.patch`.
- Live-only, deliberately not vendored: `pi-core-event-command-context` (`fix-pi-core-event-command-context.mjs`), which patches `@earendil-works/pi-coding-agent` core rather than an extension. An autostarted plan-mode session never runs `/plan`, so the auto fresh-implementation handoff needs it in interactive sessions; `sync-classify.conf` keeps it out of the repo.
- Live-only, deliberately not vendored: `pi-core-stale-emit-guard` (`fix-pi-core-stale-emit-guard.mjs`), which skips remaining `agent_settled` handlers after session replacement invalidates their context and suppresses stale-context errors from handlers already suspended; `sync-classify.conf` keeps it out of the repo.

The registry is merge-managed: `install.sh` and `install.ps1` skip it during the checksum sync and then union the shipped entries with any local-only entries by name, so a machine-specific entry such as `pi-core-event-command-context` survives an install instead of being overwritten by the shipped file.

## Manual steps after install

1. Provider auth: run `pi` and authenticate. Credentials stay on your machine, never in this repo.
2. Plan mode needs no patch step: `pi/packages/better-plan-mode` is vendored source and carries the reviewed read-only policy, `bashMode`, and the auto-implementation handoff natively. Re-vendor it from the fork checkout after fork changes (copy `src/`, `docs/`, `README.md`, and `LICENSE`, then flip `.js` import specifiers to `.ts`; the vendored directory is source-only, so fork tests stay in the fork checkout).
3. After any pi package update, re-run the codemode-content guard and its verifier: `node ~/.pi/agent/patches/fix-codemode-content.mjs && node ~/.pi/agent/patches/verify-codemode-content.mjs`.

## Layout

```
pi/                -> ~/.pi/agent/ (settings.json, config.yml, AGENTS.md, agents/,
                      extensions/, packages/, patches/, scripts/, skills/,
                      plugin configs: caveman/pi-plan-mode/efficient-pi-ask-user/
                      local-bash/hide-providers *.json)
skills/            -> ~/.agents/skills/ (47 vendored dirs; xias-* recreated as symlinks)
custom-extensions/ -> local Pi extension source packages
memory/            -> hermes/projects memory content (no binary state)
manifest.lock      determinism source: tool pins + sha256 of every managed file
install.sh         bash/macOS/Linux one-liner target
install.ps1        Windows PowerShell twin
```
