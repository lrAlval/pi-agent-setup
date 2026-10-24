# AGENTS.md — pi-agent-setup repo conventions

Installer repo for a personal Pi coding-agent setup. Layout follows the
[agent-stuff](https://github.com/mitsuhiko/agent-stuff) structure: root
`extensions/`, `agents/`, `skills/`, `themes/`, `config/`, `scripts/`,
`templates/`, plus `memory/` and the two installers.

## Layout map

| Repo dir | Installs to |
|---|---|
| `extensions/` `agents/` `themes/` `config/` `scripts/` `templates/` | `~/.pi/agent/<same>` — `config/*` lands directly in `~/.pi/agent/` |
| `skills/` | `~/.agents/skills/` |
| `skills/<name>/` with a `.pi-target` marker | `~/.pi/agent/skills/<name>/` (pi-only skills) |
| `memory/` | `~/.pi/agent/pi-hermes-memory/` (`memory/projects/` → `~/.pi/agent/projects-memory/`) |

`config/AGENTS.md` and `config/OPINIONS.md` are the **live-dir** mirrors (they
install to `~/.pi/agent/`). This file is the **repo** conventions doc — a
different file, do not merge them.

## `.pi-target` marker contract

A skill that must live in `~/.pi/agent/skills/` instead of
`~/.agents/skills/` carries a marker file `skills/<name>/.pi-target`: a plain
file whose content is the single line `pi`. Current markers:
`agent-routing`, `slice-tasks`, `uix`.

To add a pi-only skill: `printf 'pi\n' > skills/<name>/.pi-target`. Markers
are install routing only — they are NEVER listed in `manifest.lock` and NEVER
synced to live (both installers and the regen command exclude them).

## Manifest regen

After changing any vendored file, regenerate from the repo root:

```bash
head -n 6 manifest.lock > manifest.lock.tmp && (find extensions agents skills themes config scripts templates memory -type f | grep -v 'skills/xias-symlinks.txt' | grep -v '\.pi-target' | grep -v '/node_modules/' | sort | xargs sha256sum | sed 's| \./|  |') >> manifest.lock.tmp && mv manifest.lock.tmp manifest.lock
```

The regeneration must produce an empty `git diff` when nothing changed.

## Verification

```bash
bash -n install.sh && bash -n sync-from-live.sh
bash -c '. ./sync-classify.conf && echo OK'
```

Rules: never hand-edit `manifest.lock`; fail loud on name collisions when
vendoring; keep the regen diff empty; do not touch `~/.pi/agent` (all sync is
via `sync-from-live.sh` review).
