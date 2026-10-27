# AGENTS.md — pi-agent-setup repo conventions

Installer repo for a personal Pi coding-agent setup. Layout follows the
[agent-stuff](https://github.com/mitsuhiko/agent-stuff) structure: root
`extensions/`, `agents/`, `skills/`, `themes/`, `config/`, `scripts/`,
`templates/`, `packages/`, plus `memory/` and the two installers.

## Layout map

| Repo dir | Installs to |
|---|---|
| `extensions/` `agents/` `themes/` `config/` `scripts/` `templates/` `packages/` | `~/.pi/agent/<same>` — `config/*` lands directly in `~/.pi/agent/` |
| `skills/` | `~/.agents/skills/` |
| `skills/<name>/` with a `.pi-target` marker | `~/.pi/agent/skills/<name>/` (pi-only skills) |
| `memory/` | `~/.pi/agent/pi-hermes-memory/` (`memory/projects/` → `~/.pi/agent/projects-memory/`) |

`config/AGENTS.md` and `config/OPINIONS.md` are the **live-dir** mirrors (they
install to `~/.pi/agent/`). This file is the **repo** conventions doc — a
different file, do not merge them.

## Worktree and branch lifecycle

- Every repo-changing session MUST use a fresh isolated treehouse worktree and a new feature branch based on the latest `origin/main`. Fetch `origin/main` before creating the worktree; verify the worktree starts from that commit. Never make repo changes in the shared checkout or continue a task on an existing feature branch.
- If the current branch's PR is merged or closed, treat that branch as dead for new work: start a new worktree and branch from updated `main`. Preserve closed-unmerged branches and their refs; do not delete them. Branch age alone does not make a branch dead.
- At session end, commit and push work on the feature branch, create a ready (non-draft) PR or reuse/update the existing PR for that branch, then return the worktree. Follow the PR body template in the `pr` skill: Summary, Evidence, Merge Danger. If work cannot be safely preserved or the required worktree/PR step fails, stop, retain the lease, and report the blocker; never lose work or fall back to the shared checkout.
- After a PR is verified merged, purge its feature branch locally and from `origin` only when the PR head belongs to this repository. Return any worktree using the branch before deleting the local ref. Never delete unrelated branches or refs.

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
head -n 6 manifest.lock > manifest.lock.tmp && (find extensions agents skills themes config scripts templates packages memory -type f | grep -v 'skills/xias-symlinks.txt' | grep -v '\.pi-target' | grep -v '/node_modules/' | sort | xargs sha256sum | sed 's| \./|  |') >> manifest.lock.tmp && mv manifest.lock.tmp manifest.lock
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
