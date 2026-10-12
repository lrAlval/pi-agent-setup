# pi-eta x rpiv-todo compat (audited against installed source)

## Verified OK
- Tool name `todo` pinned (TOOL_NAME const, never rename per rpiv comment).
- `details` = TaskDetails {action, params, tasks, nextId} on every tool result.
- Metadata passes through: create copies, update merges (null deletes key).
- Metadata-only update counts as state change -> estimate corrections flow through replay.
- sanitize.ts ignores metadata -> est_minutes survives.
- Injection is schema-valid (TodoParamsSchema has metadata field) -> no validation breakage.
- Statuses exactly pending/in_progress/completed/deleted.
- getBranch() exists on ReadonlySessionManager (1.1.0).
- Guideline append coexists with rpiv own promptGuidelines.

## Fixed during audit
- Replay entry shapes were wrong (guessed). Now mirrors state/replay.ts:
  custom {type:custom, customType:rpiv-todo-state, data} authoritative;
  else message {role:toolResult, toolName:todo} last-write-wins.

## Known behavior note
- Injecting est_minutes into an otherwise no-op update turns it into a real
  metadata change (rpiv appends state entry, reports Updated). Intended: estimate recorded.
