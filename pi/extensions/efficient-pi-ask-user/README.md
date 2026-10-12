# efficient-pi-ask-user

Local fork of `@juicesharp/rpiv-ask-user-question@2.12.0` (MIT, see LICENSE).
Registers the `ask_user_question` tool. Loads from this directory, which pi
resolves **before** npm packages — first registration per name wins, so this
fork shadows any npm copy of the same tool.

## Why a fork

- Question cap is configurable (default **6**, was hardcoded 4).
- Lean-style compact declaration by default (~80% fewer prompt tokens:
  stripped schema descriptions, one-line tool description, empty prompt
  snippet, single guideline line).
- Zero npm dependencies (own config loader, English-only UI).

## Config — `~/.pi/agent/efficient-pi-ask-user.json`

(`$PI_CODING_AGENT_DIR` honored; legacy fallback
`~/.config/efficient-pi-ask-user/config.json`. Caps freeze at load —
restart Pi after changing them. Invalid values warn and fall back.)

| field | default | range |
|---|---|---|
| maxQuestions | 6 | 1-12 |
| minOptions | 2 | 1-4 |
| maxOptions | 4 | min-8 |
| maxHeaderLength | 16 | 4-64 |
| maxLabelLength | 60 | 10-200 |
| allowMultiSelect | true | bool |
| allowPreview | true | bool |
| compactSchema | true | bool |
| collapseKey | "ctrl+]" | key spec or "off" |
| guidance.{description,promptSnippet,promptGuidelines} | {} | overrides |

## Notes

- `plan_mode_question` (pi-plan-mode, max 3) is intentionally untouched — its
  execute satisfies the /plan finalize gate. Batches of 4-6 go through this tool.
- Event channels `rpiv:ask-user:prompt` / `rpiv:ask-user:blocked` kept for
  existing listeners. See FORK_OVERRIDES.md for the full delta list.
