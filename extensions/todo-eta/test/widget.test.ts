import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initialTaskState, applyBatch, type TaskState } from "../src/tasks.ts";
import type { Observation } from "../src/eta.ts";
import { computeCorrection, calibration } from "../src/eta.ts";
import { renderWidgetLines, renderOverlayLines, renderBar, bandMinutes, formatEta, truncateToWidth } from "../src/widget.ts";

function sampleState(): TaskState {
  const state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "Active task", estimateMin: 5, start: true },
    { op: "create", ref: "b", title: "Ready task", estimateMin: 4 },
    { op: "create", ref: "c", title: "Blocked task", estimateMin: 3, deps: ["a"] },
    { op: "create", ref: "d", title: "Done task", estimateMin: 2 },
    { op: "create", ref: "e", title: "Done task two", estimateMin: 2 },
  ]).state;
  state.tasks[3].status = "completed";
  state.tasks[4].status = "completed";
  return state;
}

function strongObservations(): Observation[] {
  const observations: Observation[] = [];
  for (let i = 0; i < 12; i++) observations.push({ id: `o${i}`, ts: i, estimateMs: 60_000, actualMs: 60_000 });
  return observations;
}

test("widget renders merged header with counts, ETA, active, ready, blocked within six lines", () => {
  const lines = renderWidgetLines({ state: sampleState() });
  assert.ok(lines[0].includes("█"));
  assert.ok(lines[0].includes("Todos 2/5 done"));
  assert.ok(lines[0].includes(" left") || lines[0].includes("m"));
  assert.ok(lines.some((line) => line.startsWith("▶ #1 ")));
  assert.ok(lines.some((line) => line.startsWith("○ #2 ")));
  assert.ok(lines.some((line) => line.startsWith("↳ #3 ")));
  assert.ok(lines.length <= 6);
});

test("widget renders nothing when there are no tasks, expanded and collapsed", () => {
  assert.deepEqual(renderWidgetLines({ state: initialTaskState() }), []);
  assert.deepEqual(renderWidgetLines({ state: initialTaskState(), collapsed: true }), []);
});

test("widget has no paused, empty, estimate, or revision noise", () => {
  const rendered = renderWidgetLines({ state: sampleState() }).join("\n");
  for (const noise of ["Paused", "no tasks", "needs revision", "Estimate exceeded", "agent not running"]) assert.ok(!rendered.includes(noise));
});

test("collapsed mode is single line with bar, count and ETA", () => {
  const lines = renderWidgetLines({ state: sampleState(), collapsed: true });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("█"));
  assert.ok(lines[0].includes("Todos 2/5 done"));
  assert.ok(/m/.test(lines[0]));
});

test("bar advances with active elapsed fraction and keeps pending work unfilled", () => {
  const state = sampleState();
  state.tasks[0].measuredMs = 150_000;
  const lines = renderWidgetLines({ state });
  assert.ok(lines[0].startsWith("████████░░░░░░░░"));
  assert.ok(lines[0].indexOf("Todos 2/5 done") < lines[0].indexOf("done ·"));
});

test("active progress caps at estimate and ignores canceled tasks in denominator", () => {
  const state = sampleState();
  state.tasks[0].measuredMs = 600_000;
  state.tasks[2].status = "cancelled";
  const lines = renderWidgetLines({ state });
  assert.ok(lines[0].startsWith("████████████░░░░"));
  assert.ok(lines[0].includes("2/4 done"));
  assert.ok(lines[0].includes("(+1 cancelled)"));
});

test("non-positive active estimate contributes no fractional progress", () => {
  const state = sampleState();
  state.tasks[0].estimateMin = 0;
  state.tasks[0].measuredMs = 60_000;
  const lines = renderWidgetLines({ state });
  assert.ok(lines[0].startsWith("██████░░░░░░░░░░"));
});

test("active row shows budget ratio, elapsed shown only when nonzero", () => {
  const state = sampleState();
  state.tasks[0].measuredMs = 480_000;
  const lines = renderWidgetLines({ state });
  const active = lines.find((line) => line.startsWith("▶"));
  assert.ok(active?.includes("8/5m"));
  const ready = lines.find((line) => line.startsWith("○"));
  assert.ok(ready && !ready.includes("elapsed"));
});

test("ETA is a band with no observations and a point value when calibrated", () => {
  const weak = renderWidgetLines({ state: sampleState() });
  assert.ok(/\d+-\d+m/.test(weak[0]), `expected band in header: ${weak[0]}`);
  const strong = renderWidgetLines({ state: sampleState(), observations: strongObservations() });
  assert.ok(/~\d+m/.test(strong[0]), `expected point ETA in header: ${strong[0]}`);
});

test("band math is symmetric and collapses to a point at strength 1", () => {
  assert.deepEqual(bandMinutes(50, 0), { lo: 25, hi: 100, weak: true });
  assert.deepEqual(bandMinutes(50, 1), { lo: 50, hi: 50, weak: false });
  assert.equal(formatEta(0, 0), "~0m");
});

test("overlay lists every task grouped with full blocker reason and footer", () => {
  const state = sampleState();
  state.tasks[2].blockerReason = "Needs review findings first";
  const lines = renderOverlayLines({ state, width: 200 });
  const text = lines.join("\n");
  assert.ok(lines[0] === "Todo ETA");
  assert.ok(text.includes("▶ #1 "));
  assert.ok(text.includes("○ #2 "));
  assert.ok(text.includes("↳ #3 "));
  assert.ok(text.includes("blocked: Needs review findings first"));
  assert.ok(text.includes("✓ #4 "));
  assert.ok(text.includes("Remaining:"));
});

test("computeCorrection outputs are unchanged by the calibration refactor", () => {
  const observations = strongObservations().map((obs, i) => ({ ...obs, actualMs: obs.actualMs * (i % 3 === 0 ? 2 : 1) }));
  const expectations: Array<[Observation[], number]> = [
    [[], 1],
    [observations, calibration(observations).ratio],
  ];
  for (const [input, expected] of expectations) assert.equal(computeCorrection(input), expected);
});

test("bar is proportional to done/total", () => {
  assert.equal(stripTerminalSequences(renderBar(2, 5, 10)), "████░░░░░░");
  assert.equal(stripTerminalSequences(renderBar(0, 3, 10)), "░░░░░░░░░░");
  assert.equal(stripTerminalSequences(renderBar(3, 3, 10)), "██████████");
  assert.equal(stripTerminalSequences(renderBar(0, 0, 10)).length, 10);
});

test("widget truncates by terminal width", () => {
  assert.equal(stripTerminalSequences(truncateToWidth("abcdefgh", 5)), "abcd…");
  assert.ok(visibleWidth(truncateToWidth("你a", 2)) <= 2);
});
