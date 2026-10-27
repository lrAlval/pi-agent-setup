## Upstream provenance

- Repository: https://github.com/Pringled/pi-extensions
- Commit: `bd6723cba2188afe2e85e70c5e89d0cbf8468031` (2026-10-27T08:17:29Z, `fix: quieter one-line rows in pi-background and pi-polish (#41)`)
- Package path: `packages/pi-next-prompt`
- Version: `0.1.2`
- Import date: 2026-10-27

## Local deviations

- Abort pending suggestion when typing or Escape dismisses it, preventing late async results from repopulating ghost text. Regression covered by `tests/pringled-lifecycle.test.mjs`.
