# stream-rules

Bounded turn-boundary rule corrections. Rules live as JSONL (one per line):

- `~/.pi/agent/stream-rules.jsonl` (global)
- `<project>/.pi/stream-rules.jsonl` (project, optional)

Rule: `{"name":"...","regex":"...","rule":"...","maxCorrections":1,"enabled":true}`.
Only `name`, `regex`, `rule` required. Bad rows surface in `/stream-rules list`, never crash load.

Fires on `turn_end`: scans last assistant message, injects one combined
correction card (file order, max 5 rules, per-rule cap default 1/turn).
Entries carry rule names in `details` → compaction-safe, no double-fire.
User abort resets counters, never forces recontinue. Empty/disabled set =
pass-through, zero context tax.

## Commands

- `/stream-rules list` — rules + parse errors
- `/stream-rules reload` — re-read both files
- `/stream-rules test <text>` — dry-run match
- `/stream-rules on|off` — toggle (off = session untouched)

## Tests

`node --experimental-strip-types --test 'test/*.test.ts'`
