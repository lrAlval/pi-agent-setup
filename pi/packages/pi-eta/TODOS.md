# pi-eta todos (harness has no todo tool - tracked here)

## Slice 1 - MVP: DONE
- [x] Scaffold package + register in settings.json
- [x] Estimate capture (guideline + tool_call injection)
- [x] Timer engine (eta.ts)
- [x] Widget + status + tick + pi-eta:eta event + /eta
- [x] Unit tests, loads clean in pi

## Slice 2 - Calibration hardening: DONE
- [x] 2.1 Sidecar for in-flight starts
- [x] 2.2 Session-id guard
- [x] 2.3 Overrun display
- [x] 2.4 Wiring tests
- [x] 2.5 Full suite green
- [x] 2.6 rpiv-todo compat audit (COMPAT.md)

## Slice 3 - Integration: DONE
- [x] 3.1 pi-footer zero-config status row, FOOTER.md
- [x] 3.2 FOOTER.md
- [x] 3.3 session_tree + session_compact re-replay
- [x] 3.4 Empty-plan + clear-action test
- [x] 3.5 Shutdown test

## Render diagnosis + fixes: DONE (34/34 green)
- [x] Root cause: codemode-only workflow never calls todo
- [x] Fix 1: guideline directs sandbox agents to tools.todo
- [x] Fix 2: turn_end re-replay catches nested mutations

## Slice 4 - Live verification: CODE DONE, 1 MANUAL STEP LEFT
- [x] 4.1 pi-eta loaded live (sidecar written 17:03, turn_end replays observed)
- [x] 4.2 E2E via tools.todo: 2 tasks est 2m/3m -> progress -> complete -> cleared
- [x] 4.3 Calibration rows live: [{2, 0.093}, {3, 0.036}] velocity still 1.0 (<3 samples)
- [x] 4.4 Cleanup done (clear, sidecar pruned to {})
- [ ] 4.5 MANUAL (user TUI): overlay + pi-eta widget + footer segment visible
