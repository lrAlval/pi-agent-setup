import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCorrection, forecast } from "../src/eta.ts";
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
