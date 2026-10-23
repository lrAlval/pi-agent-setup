# agent-hub

Fullscreen read-only task roster (v1).

- `/hub` or `Alt+A` (`Ctrl+Alt+H` fallback) opens the roster.
- Roster = last pi-background-tasks host frame merged with a
  `<cwd>/.pi/tasks` snapshot scan (frame wins; fs outputPath kept).
- No frames yet → explicit "0 live frames (fs fallback)".
- No tasks → explicit "0 tasks" row, never a blank screen.
- Malformed frame → raw-preserved `unknown` row + loud error row.
- Width < 40 cols → compact rows.
- Read-only: no kill/steer. Use `/kill <id>`.
- Non-TUI mode: `/hub` prints a text roster via notify.

Keys: `up/down/k/j` move, `enter` tail, `space` detail, `r` refresh, `q/Esc` close.

Channel strings live in `constants.ts` (provenance: pi-background-tasks
`src/core/host-protocol.ts:14-16`, `:v1` tags). Bump them if upstream bumps.

## Live check (A6)

1. Start a bg task: `sleep 30 &` via bg_run (or `pi -- ... &`).
2. Open interactive `pi`, press `Alt+A`.
3. Expect one `running` row with the task name; `enter` shows tail;
   `Esc` closes. Empty roster shows the explicit 0-tasks line.

## Tests

`node --experimental-strip-types --test 'test/*.test.ts'`
