import test from "node:test";
import assert from "node:assert/strict";
import { ActiveClock } from "../src/timing.ts";
import type { Task } from "../src/tasks.ts";

const task: Task = { id: 7, title: "Work", status: "in_progress", deps: [], estimateMin: 5, budgetMin: 5, measuredMs: 0 };

test("clock counts only agent-run time and pauses between runs", () => {
  let now = 0;
  const clock = new ActiveClock(() => now);
  clock.syncTask({ ...task });
  clock.agentStart();
  now += 20_000;
  clock.agentEnd();
  assert.equal(clock.snapshot().measuredMs, 20_000);
  now += 60_000;
  clock.agentStart();
  now += 10_000;
  assert.equal(clock.turnEnd().measuredMs, 30_000);
});

test("prompt and fork lifecycle pause and stale running restores aborted", () => {
  let now = 100;
  const clock = new ActiveClock(() => now);
  clock.syncTask({ ...task });
  clock.agentStart();
  now += 15_000;
  assert.equal(clock.sessionBeforeFork().status, "aborted");
  const restoredTask = { ...task };
  clock.restore({ v: 1, taskId: 7, measuredMs: 10, runActive: true, intervalStartMs: 9, status: "running", eligible: true }, restoredTask);
  assert.equal(clock.snapshot().status, "aborted");
  assert.equal(clock.snapshot().eligible, false);
  assert.equal(restoredTask.measuredMs, 10);
  assert.equal(clock.agentStart().status, "running");
});
