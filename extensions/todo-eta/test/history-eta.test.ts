import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abortObservationFor, computeCorrection, forecast, projectFraction, projectRemaining } from "../src/eta.ts";
import { loadRecentObservations, publishObservation } from "../src/history.ts";
import { initialTaskState, applyBatch } from "../src/tasks.ts";

test("calibration ramps to full strength at three observations and clamps at 0.05", () => {
  const fast = { id: "x", ts: 0, estimateMs: 100, actualMs: 900 };
  const short = { id: "y", ts: 0, estimateMs: 100, actualMs: 4.1 };
  assert.equal(computeCorrection([]), 1);
  assert.equal(computeCorrection([fast, fast, fast]), 4);
  assert.equal(computeCorrection([short, short]), 0.3606666666666667);
  assert.equal(computeCorrection([short, short, short]), 0.05);
});

test("abort observation captures measured active work only", () => {
  const state = applyBatch(initialTaskState(), [{ op: "create", ref: "a", title: "A", estimateMin: 27, start: true }]).state;
  assert.equal(abortObservationFor(state, 123), undefined);
  state.tasks[0].measuredMs = 120_000;
  assert.deepEqual(abortObservationFor(state, 456), {
    taskId: state.tasks[0].id,
    completedTs: 456,
    estimateMs: 27 * 60_000,
    actualMs: 120_000,
  });
  state.tasks[0].status = "cancelled";
  assert.equal(abortObservationFor(state, 789), undefined);
});

test("immutable observation publication deduplicates and loads newest bounded history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "todo-eta-"));
  try {
    const obs = { taskId: 3, completedTs: 99, estimateMs: 60_000, actualMs: 120_000 };
    assert.equal(await publishObservation(obs, dir), "created");
    assert.equal(await publishObservation(obs, dir), "duplicate");
    assert.equal((await loadRecentObservations(200, dir)).length, 1);
    assert.equal((await readdir(dir)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("forecast freezes budget and marks active estimate for revision", () => {
  const state = applyBatch(initialTaskState(), [{ op: "create", ref: "a", title: "A", estimateMin: 5, start: true }]).state;
  state.tasks[0].measuredMs = 300_000;
  const result = forecast(state);
  assert.equal(result.needsRevision, true);
  assert.equal(result.totalRemainingMin, 0);
});

test("projection shrinks remaining from live observations", () => {
  const state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "A", estimateMin: 10, start: true },
    { op: "create", ref: "b", title: "B", estimateMin: 10 },
  ]).state;
  state.tasks[0].measuredMs = 60_000;
  const obs = [{ id: "x", ts: 0, estimateMs: 60_000, actualMs: 30_000 }];
  assert.equal(forecast(state).totalRemainingMin, 19);
  // median ratio 0.5, ramp strength 1/3 → r = 5/6
  assert.equal(forecast(state, obs).totalRemainingMin, 15.666666666666668);
  const fraction = projectFraction(state, obs);
  assert.ok(fraction > 0 && fraction < 1);
  assert.equal(projectFraction(state, []), 1 / 20);
});

test("empty observations fall back to legacy budget minimum", () => {
  const state = applyBatch(initialTaskState(), [{ op: "create", ref: "a", title: "A", estimateMin: 7, start: true }]).state;
  state.tasks[0].measuredMs = 120_000;
  assert.equal(projectRemaining(state.tasks[0], []), 5);
  assert.equal(forecast(state, []).totalRemainingMin, 5);
});
