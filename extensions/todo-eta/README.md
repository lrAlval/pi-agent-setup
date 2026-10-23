# todo-eta

Guarded multi-step task tracking for Pi. The `todo_eta` tool lists tasks or applies an atomic batch with dependency, blocker, and single-active-task guards. Estimates are calibrated from completed-task observations, and the `todo-eta` widget shows ready and blocked work.

History stores opaque estimate/actual timing observations under `${XDG_STATE_HOME:-~/.local/state}/pi-todo-eta/history-v1/`. Set `PI_TODO_ETA_STATE_DIR` to override history directory for isolated tests. History is immutable; cleanup is manual. Existing `pi-todo-eta` state is not migrated or read.

Development:

```sh
cd pi/extensions/todo-eta
npm ci
npm run typecheck
node --import tsx --test
cd ../../..
pi --extension ./pi/extensions/todo-eta
```

Use `/todo-eta` to inspect task state and `/todo-eta collapse` to collapse widget.
