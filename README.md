# pi-agent-setup

Vanilla pi gives you a model and tools. This repo turns it into an opinionated, ready-to-install agent stack: extensions, subagents, skills, rules, memory, and token-efficiency features. Install with one line:

```bash
curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex
```

Re-running is safe: installer is idempotent. Windows is supported best-effort; stack is WSL-first.

## Extensions

- [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system) - gates destructive commands and sensitive paths.
- [`pi-hide-providers`](pi/extensions/) - keeps provider routing focused.
- [`pi-rtk-optimizer`](pi/extensions/) - compacts tool output and tracks savings.
- [`pi-hermes-memory`](pi/extensions/) and `pi-observational-memory` - persist and recall session context.
- [`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) - searchable, interlinked Markdown knowledge base.
- [`@henryqw/pi-codegraph`](https://github.com/henryqw/pi-codegraph) and `pi-ast-grep` - structural code exploration and syntax-aware search.
- [`pi-smart-fetch`](https://github.com/earendil-works/pi-smart-fetch) and `pi-mcp-adapter` - readable web fetch and MCP connectivity.
- [`@davecodes/pi-dcp`](https://github.com/davecodes/pi-dcp) - prunes stale context.
- [`pi-subagents-lite`](pi/agents/) - isolated delegation with 13 configured agents.
- [`git:pi-fork`](https://github.com/earendil-works/pi-fork) - branch-aware child sessions with structured reports.
- [`todo-eta`](pi/extensions/todo-eta/) - guarded task batches, progress widget, ETA, and estimate calibration.
- [`pi-background-tasks`](https://github.com/earendil-works/pi-background-tasks) - long-running shell jobs and agents.
- [`@plannotator/pi-extension`](https://github.com/Plannotator/extension) - plan annotation and review.
- [`ponytail`](https://github.com/dietrichgebert/ponytail) and [`pi-footer`](pi/extensions/) - live spend, savings, branch, and model status.
- [`@henryqw/pi-undo`](https://github.com/henryqw/pi-undo) - reverses agent edits.
- [`pi-observability-plugin`](pi/packages/pi-observability-plugin/) - Langfuse-backed run traces.
- [`git:pi-community-themes`](https://github.com/Agent-Field/pi-community-themes) - additional terminal themes.
- [`@vigolium/piolium`](https://github.com/vigolium/piolium) - extra Pi tooling.
- [`spine-enforcer`](pi/extensions/spine-enforcer/) - enforces goal, spec, and state conventions.
- [`pi-codemode-toggle`](pi/extensions/) - toggles codemode when needed.
- [`pi-caveman`](https://github.com/earendil-works/pi-caveman) - compresses responses for token efficiency.

## Skills and rules

- `skills/` contains 47 vendored skills; installer recreates 25 XIAS kit skills as symlinks to the installed UX/UI kit.
- `pi/AGENTS.md` keeps always-loaded guidance lean and routes specialized rules through skills and extensions. Its default-on plan gate is instruction-only, with no plan-mode extension or mode-specific settings.
- `ui-sdlc` coordinates intent, design, build, gates, review, validation, and delivery; XIAS is the design-system backbone.

## Token efficiency

Compaction, concise responses, persistent recall, structural search, isolated agents, and model routing reduce rediscovery and context overhead; live savings appear in the footer and RTK tracking.

## Repository layout

```
pi/                -> ~/.pi/agent/ (settings.json, config.yml, AGENTS.md, agents/,
                      extensions/, packages/, patches/, scripts/, skills/,
                      plugin configs: caveman/hide-providers *.json)
skills/            -> ~/.agents/skills/ (47 vendored dirs; xias-* recreated as symlinks)
memory/            -> hermes/projects memory content (no binary state)
manifest.lock      determinism source: tool pins + sha256 of every managed file
install.sh         bash/macOS/Linux one-liner target
install.ps1        Windows PowerShell twin
```

## Development

- Run installer changes in a scratch HOME with `bwrap`, never against live configuration.
- Run repository checks with `bash -n install.sh sync-from-live.sh`, JSON validation, and manifest checksum verification before submitting.
