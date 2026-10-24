import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCorrection, forecast, projectFraction, projectRemaining } from "../src/eta.ts";
import { loadRecentObservations, publishObservation } from "../src/history.ts";
import { initialTaskState, applyBatch } from "../src/tasks.ts";

test("calibration uses ramp, median, and clamp", () => {
  assert.equal(computeCorrection([]), 1);
  assert.equal(computeCorrection(Array.from({ length: 10 }, () => ({ id: "x", ts: 0, estimateMs: 100, actualMs: 900 }))), 4);
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
  // median ratio 0.5, ramp strength 1/10 → r = 0.95
  assert.equal(forecast(state, obs).totalRemainingMin, 18);
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
