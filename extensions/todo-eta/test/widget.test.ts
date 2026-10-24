import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initialTaskState, applyBatch, type TaskState } from "../src/tasks.ts";
import { renderWidgetLines, renderBar, formatTimer, truncateToWidth } from "../src/widget.ts";

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

test("widget renders header bar, timer, counts, active, ready, blocked within six lines", () => {
  const lines = renderWidgetLines({ state: sampleState(), sessionMs: 90_000 });
  assert.ok(lines[0].includes("█"));
  assert.ok(lines[0].includes("1:30"));
  assert.ok(lines[0].includes("2/5 tasks"));
  assert.ok(lines.some((line) => line.startsWith("▶")));
  assert.ok(lines.some((line) => line.startsWith("○")));
  assert.ok(lines.some((line) => line.startsWith("↳")));
  assert.ok(lines.length <= 6);
});

test("widget renders nothing when there are no tasks, expanded and collapsed", () => {
  assert.deepEqual(renderWidgetLines({ state: initialTaskState() }), []);
  assert.deepEqual(renderWidgetLines({ state: initialTaskState(), collapsed: true }), []);
});

test("widget has no paused, empty, estimate, or revision noise", () => {
  const rendered = renderWidgetLines({ state: sampleState(), sessionMs: 5_000 }).join("\n");
  for (const noise of ["Paused", "no tasks", "needs revision", "Estimate exceeded", "agent not running"]) assert.ok(!rendered.includes(noise));
});

test("collapsed mode is single line with bar, timer and count", () => {
  const lines = renderWidgetLines({ state: sampleState(), collapsed: true, sessionMs: 61_000 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("█"));
  assert.ok(lines[0].includes("1:01"));
  assert.ok(lines[0].includes("2/5 tasks"));
});

test("bar is proportional to done/total", () => {
  assert.equal(stripTerminalSequences(renderBar(2, 5, 10)), "████░░░░░░");
  assert.equal(stripTerminalSequences(renderBar(0, 3, 10)), "░░░░░░░░░░");
  assert.equal(stripTerminalSequences(renderBar(3, 3, 10)), "██████████");
  assert.equal(stripTerminalSequences(renderBar(0, 0, 10)).length, 10);
});

test("timer formats m:ss under an hour and h:mm:ss above", () => {
  assert.equal(formatTimer(0), "0:00");
  assert.equal(formatTimer(5_400), "0:05");
  assert.equal(formatTimer(3_723_000), "1:02:03");
});

test("widget truncates by terminal width", () => {
  assert.equal(stripTerminalSequences(truncateToWidth("abcdefgh", 5)), "abcd…");
  assert.ok(visibleWidth(truncateToWidth("你a", 2)) <= 2);
});
