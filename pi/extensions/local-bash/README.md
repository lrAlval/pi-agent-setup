# local-bash

Plan-mode-friendly shell tool (`local_bash`). Allows full shell composition -
loops, pipes, `$(...)`, backticks, `&&`/`||`/`;` chains - and blocks only
destructive commands. Fail-closed: unscannable input is rejected.

This vendored copy additionally ships command-position denylist matching,
the opt-in `/tmp` scratch allowance and the bwrap sandbox lane, so agent
installer self-tests no longer need to be punted to the user.

## Allowed (plan-mode inspection)

`for n in ...; do gh issue view $n ...; done`, `git log/diff/status`,
`gh issue|pr view|list`, `gh search`, `gh api` GET, greps in loops,
`$(( ))` arithmetic, `2>&1`, `> /dev/null`.
Package-manager names as *arguments* (`which npm`, `grep -n npm file`), a
bare dot as a pattern argument (`grep -c . file`), and
`git branch --show-current` all pass: matching is command-position only.

## Blocked

- Deletion/mutation: `rm`, `mv`, `cp`, `ln`, `install`, `tee`, `mkdir`,
  `touch`, `patch`, `chmod/chown`, `dd`, `mkfs`, `truncate`, `sed -i`,
  `find -delete/-exec`, file redirects (`>`/`>>`), heredocs (`<<`/`<<<`)
- Escalation/execution: `sudo`, `eval`/`source`, pipe-to-shell
  (`| bash`), `$(curl...)` remote-code substitution, `python -c`/`node -e`
  (head-anchored), loader-path overrides (`PATH=`/`LD_PRELOAD=`...),
  shell script execution (`bash install.sh` - opaque file content),
  `>&file` combined redirect
- Mutating subcommands: `git push|commit|...`, `gh create|merge|...`,
  `gh api -X POST|PUT|PATCH|DELETE`, package installs as commands
  (`npm|brew|apt|...`), `docker rm|run|exec`, `kubectl apply|delete`,
  `systemctl restart|...`, `ssh`, `crontab` (except `-l`), `mount`, `reg add`
- Read-only allowlists: git / gh / docker / kubectl / systemctl subcommands
  not on the list are blocked (e.g. bare `git stash` pushes - blocked).

Quoted prose is blanked before scanning (`grep "rm -rf" file` passes);
`$(...)`/backticks stay code (they execute); unbalanced input fails closed.
Unquoted `echo rm` stays blocked: quote prose (`echo "rm"`) to pass it.

## Config - `~/.pi/agent/local-bash.json`

| field | default |
|---|---|
| extraBlocked | [] - extra regex strings tested against the scanned command |
| allowedPrefixes | [] - exact command prefixes that bypass the denylist |
| timeoutMs | 60000 (min 1000) |
| maxOutputBytes | 51200 per stream (min 1024) |
| reviewScratch | false - allow mkdir/touch/`>`/`>>` strictly under /tmp or $TMPDIR |
| sandboxAllowFallback | false - run unsandboxed (with warning) if bwrap is missing |
| sandbox.allowNetwork | true - share host network inside the sandbox |

Must be listed in pi-plan-mode `defaultPlanTools` to be usable in plan mode.
Non-zero exits return `isError: true` with exit code + split stdout/stderr.

## Scratch writes (`reviewScratch: true`)

When on, `mktemp`, `mkdir`, `touch`, single-target `>`/`>>` redirects and env
exports pass if every write target resolves under `/tmp` or `$TMPDIR`.
Tracked variables work: `T=$(mktemp -d)` then `$T/...` targets.
Fail-closed: globs, unresolvable `$VAR`, quoted redirect targets, `~`/HOME
and repo paths stay blocked, as do `rm`, installs and heredocs. Do not quote
scratch redirect targets (`> "$T/f"` stays blocked).

## Sandbox lane (`sandbox: true` tool param)

Runs the command under `bwrap`: repo + system paths read-only, one fresh
scratch dir + `/tmp` writable, `HOME`/`TMPDIR` pointed at scratch,
`PI_SETUP_*` env passed through. Use for package installs and installer
self-tests - never as the default exec path. Mutation rules are bypassed
(the OS enforces), but privilege escalation, remote execution, dynamic
sourcing, loader overrides, heredocs and outside-scratch redirects stay
blocked. Missing bwrap fails loud unless `sandboxAllowFallback: true`.

## Agent self-test recipe (installer)

```bash
T=$(mktemp -d)
PI_SETUP_REPO_DIR=/path/to/pi-agent-setup \
PI_SETUP_SKIP_PI_INSTALL=1 \
HOME=$T bash pi-agent-setup/install.sh   # via sandbox:true, or reviewScratch
```

Second run must report idempotency (`already installed ... nothing to do` /
`up-to-date, 0 files changed`).

## Tests

bun:test suite in `index.test.ts` (needs the typebox stub preload):

```bash
bun test --preload pi/extensions/local-bash/typebox-stub.ts \
  pi/extensions/local-bash/index.test.ts
```

Covers all verbatim incident commands, true positives, `reviewScratch` cases
and pure sandbox-policy checks. bwrap smoke + installer self-test are manual
verify gates (see PR notes).
