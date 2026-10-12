# efficient-pi-ask-user — fork deltas vs @juicesharp/rpiv-ask-user-question@2.12.0 (MIT)

Vendored 2026-10-10. Everything not listed here is byte-identical upstream
runtime (questionnaire TUI state machine, views, RPC fallback, reconciler,
event channels `rpiv:ask-user:prompt` / `rpiv:ask-user:blocked` — kept so
existing listeners keep working).

## Changed files

- `config.ts` — REWRITTEN. Own JSON loader, zero deps. Reads
  `$PI_CODING_AGENT_DIR/efficient-pi-ask-user.json` (default
  `~/.pi/agent/efficient-pi-ask-user.json`), legacy fallback
  `~/.config/efficient-pi-ask-user/config.json`. New fields:
  `maxQuestions` (default 6, 1-12), `minOptions` (2, 1-4), `maxOptions`
  (4, min-8), `maxHeaderLength` (16, 4-64), `maxLabelLength` (60, 10-200),
  `allowMultiSelect` (true), `allowPreview` (true), `compactSchema` (true).
  Kept: `collapseKey`, `guidance.{description,promptSnippet,promptGuidelines}`.
  Invalid values warn to stderr and fall back — never a broken session.
  Caps freeze at extension load (restart Pi after changing them).
- `tool/types.ts` — `MAX_QUESTIONS/MIN_OPTIONS/MAX_OPTIONS/`
  `MAX_HEADER_LENGTH/MAX_LABEL_LENGTH` now come from config; added
  `ALLOW_MULTI_SELECT/ALLOW_PREVIEW` exports and
  `multi_select_disabled|preview_disabled` error variants. Description
  strings are limit-templated.
- `tool/validate-questionnaire.ts` — rejects `multiSelect: true` when
  `allowMultiSelect: false` and non-empty `preview` when
  `allowPreview: false`, with retry-able error messages.
- `ask-user-question.ts` — added `COMPACT_*` declaration (one-line tool
  description, empty prompt snippet, single guideline line) used when
  `compactSchema: true`; `removeSchemaDescriptions()` strips schema
  descriptions at registration (concept from
  @ssk_dev/rpiv-ask-user-question-lean).
- `index.ts` — new header, dropped the rpiv-i18n SDK registration block
  (unresolvable from a local extension dir; English fallbacks stay).
- `state/i18n-bridge.ts` — namespace renamed to `efficient-pi-ask-user`.
- `state/external-editor.ts` — tmpdir prefix renamed.
- Deleted: upstream `config.ts` (replaced), `docs/`, `*.test.ts`,
  `README.md`/`package.json`/`configuration.md` etc. (replaced by local docs).

## Deliberately NOT changed

- `plan_mode_question` (pi-plan-mode) stays at 3 — its execute calls
  `finalizationRequest.satisfy()` inside pi-plan-mode's closure; shadowing it
  would break the /plan finalize gate. Batches of 4-6 go through this tool.
