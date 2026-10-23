import test from "node:test";
import assert from "node:assert/strict";
import { applyBatch, BatchError, initialTaskState } from "../src/tasks.ts";

test("batch create, temporary refs, and calibrated frozen budget", () => {
  const result = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "First", estimateMin: 10, start: true },
    { op: "create", ref: "b", title: "Second", estimateMin: 20, deps: ["a"] },
  ], (estimate) => estimate * 1.5);
  assert.equal(result.state.activeId, 1);
  assert.equal(result.state.tasks[1].deps[0], 1);
  assert.equal(result.state.tasks[0].budgetMin, 15);
  assert.equal(result.nextReadyId, null);
});

test("batch failure rolls back all operations", () => {
  const before = initialTaskState();
  assert.throws(() => applyBatch(before, [
    { op: "create", ref: "x", title: "X", estimateMin: 5 },
    { op: "start", ref: "missing" },
  ]), BatchError);
  assert.deepEqual(before.tasks, []);
  assert.equal(before.nextId, 1);
});

test("dependency blocks start and completion; completion unlocks next task", () => {
  const a = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "A", estimateMin: 10 },
    { op: "create", ref: "b", title: "B", estimateMin: 5, deps: ["a"] },
  ]).state;
  assert.throws(() => applyBatch(a, [{ op: "start", ref: 2 }]), /blocked or not ready/);
  const started = applyBatch(a, [{ op: "start", ref: 1 }]);
  const completed = applyBatch(started.state, [{ op: "complete", ref: 1 }]);
  assert.equal(completed.nextReadyId, 2);
});

test("single active guard, cycle guard, cancel blocker, and reopen rules", () => {
  const tasks = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "A", estimateMin: 4 },
    { op: "create", ref: "b", title: "B", estimateMin: 4, deps: ["a"] },
  ]).state;
  assert.throws(() => applyBatch(tasks, [{ op: "start", ref: 1 }, { op: "start", ref: 2 }]), /already in progress/);
  assert.throws(() => applyBatch(tasks, [{ op: "create", ref: "c", title: "C", estimateMin: 5, deps: ["c"] }]), BatchError);
  const cancelled = applyBatch(tasks, [{ op: "cancel", ref: 1 }]).state;
  assert.match(cancelled.tasks[1].blockerReason ?? "", /cancelled task 1/);
  const cancelledDependent = applyBatch(cancelled, [{ op: "cancel", ref: 2 }]).state;
  assert.throws(() => applyBatch(cancelledDependent, [{ op: "reopen", ref: 2 }]), /incomplete dependency/);
  const reopenedA = applyBatch(cancelledDependent, [{ op: "reopen", ref: 1 }]).state;
  const startedA = applyBatch(reopenedA, [{ op: "start", ref: 1 }]).state;
  const completedA = applyBatch(startedA, [{ op: "complete", ref: 1 }]).state;
  const reopenedB = applyBatch(completedA, [{ op: "reopen", ref: 2 }]);
  assert.equal(reopenedB.state.tasks[1].status, "pending");
  assert.equal(reopenedB.state.tasks[1].blockerReason, undefined);
  assert.equal(reopenedB.nextReadyId, 2);
});

test("reopen requires completed dependents to be reopened first", () => {
  const tasks = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "A", estimateMin: 2 },
    { op: "create", ref: "b", title: "B", estimateMin: 2, deps: ["a"] },
  ]).state;
  const doneA = applyBatch(tasks, [{ op: "start", ref: 1 }, { op: "complete", ref: 1 }]).state;
  const doneB = applyBatch(doneA, [{ op: "start", ref: 2 }, { op: "complete", ref: 2 }]).state;
  assert.throws(() => applyBatch(doneB, [{ op: "reopen", ref: 1 }]), /completed dependent/);
  const reopenedB = applyBatch(doneB, [{ op: "reopen", ref: 2 }]).state;
  const reopenedA = applyBatch(reopenedB, [{ op: "reopen", ref: 1 }]);
  assert.equal(reopenedA.state.activeId, null);
  assert.equal(reopenedA.nextReadyId, 1);
});

test("complete yields timing observation only when measured", () => {
  const started = applyBatch(initialTaskState(), [{ op: "create", ref: "a", title: "A", estimateMin: 5, start: true }]).state;
  started.tasks[0].measuredMs = 120_000;
  const complete = applyBatch(started, [{ op: "complete", ref: 1 }], undefined, 42);
  assert.deepEqual(complete.completedObs, [{ taskId: 1, completedTs: 42, estimateMs: 300_000, actualMs: 120_000 }]);
});
