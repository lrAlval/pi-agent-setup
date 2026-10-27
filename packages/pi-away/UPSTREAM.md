## Upstream provenance

- Repository: https://github.com/Pringled/pi-extensions
- Commit: `bd6723cba2188afe2e85e70c5e89d0cbf8468031` (2026-10-27T08:17:29Z, `fix: quieter one-line rows in pi-background and pi-polish (#41)`)
- Package path: `packages/pi-away`
- Version: `0.1.2`
- Import date: 2026-10-27

## Local deviations

- Replace pending idle timers on each completed turn; cancel clears timer/request state; overlapping recaps abort older requests and only latest request may publish. Regression covered by `tests/pringled-lifecycle.test.mjs`.
