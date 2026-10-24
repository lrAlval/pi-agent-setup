import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initialTaskState, applyBatch } from "../src/tasks.ts";
import type { Observation } from "../src/eta.ts";
import { renderAggregateBar, renderBarCells, renderWidgetLines, truncateToWidth } from "../src/widget.ts";

const sampleState = () => {
  let state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "Active task", estimateMin: 5, start: true },
    { op: "create", ref: "b", title: "Ready task", estimateMin: 4 },
    { op: "create", ref: "c", title: "Blocked task", estimateMin: 3, deps: ["a"] },
  ]).state;
  state.tasks[1].blockerReason = "waiting";
  return state;
};

const sampleObs: Observation[] = [{ id: "x", ts: 0, estimateMs: 60_000, actualMs: 30_000 }];
const themeStub = { fg: (_color: unknown, text: string) => `m(${text})`, bold: (text: string) => `b(${text})` };

test("widget renders active, ready, blocked and stays within seven lines", () => {
  const lines = renderWidgetLines({ state: sampleState(), paused: true });
  assert.ok(lines[0].startsWith("▶"));
  assert.ok(lines.some((line) => line.startsWith("↳")));
  assert.ok(lines.length <= 7);
});

test("expanded widget ends with aggregate bar and percent label", () => {
  const lines = renderWidgetLines({ state: sampleState(), observations: sampleObs, paused: true });
  const bar = lines.at(-1) ?? "";
  assert.ok(/[▰▱]/.test(bar));
  assert.match(bar, /%\s*·\s*[\d.]+m left/);
});

test("bar cells clamp fraction and honor minimum width", () => {
  assert.equal(renderBarCells(0.5, 10), "▰▰▰▰▰▱▱▱▱▱");
  assert.equal(renderBarCells(1, 0), "▰▰");
  assert.ok(renderBarCells(Number.NaN, 10).startsWith("▱"));
});

test("aggregate bar render supports bare cells and label", () => {
  assert.equal(renderAggregateBar(0, 4, ""), "▱▱▱▱");
  assert.equal(renderAggregateBar(1, 2, "done"), "▰▰ done");
});

test("all-completed state shows Done bar", () => {
  const state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "A", estimateMin: 5, start: true },
    { op: "complete", ref: "a" },
  ]).state;
  const lines = renderWidgetLines({ state });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /Done · 0m left/);
});

test("collapsed widget is a one-liner with mini bar", () => {
  const lines = renderWidgetLines({ state: sampleState(), collapsed: true });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.startsWith("▶ Active task"));
  assert.ok(/[▰▱]/.test(lines[0] ?? ""));
  assert.match(lines[0] ?? "", /m$/);
});

test("theme stub styles active bold and rest muted", () => {
  let state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "Active task", estimateMin: 5, start: true },
    { op: "create", ref: "b", title: "Ready task", estimateMin: 4 },
    { op: "create", ref: "c", title: "Blocked task", estimateMin: 3, deps: ["a"] },
  ]).state;
  const lines = renderWidgetLines({ state, observations: sampleObs, paused: true, theme: themeStub });
  assert.ok(lines[0]?.startsWith("b(▶ Active task"));
  assert.ok(lines.some((line) => line.startsWith("m(○ Ready task")));
  assert.ok(lines.some((line) => line.startsWith("m(↳ Blocked task")));
  assert.ok(!lines.at(-1)?.startsWith("m(")); // bar line stays plain
});

test("widget truncates by terminal width", () => {
  assert.equal(stripTerminalSequences(truncateToWidth("abcdefgh", 5)), "abcd…");
  assert.ok(visibleWidth(truncateToWidth("你a", 2)) <= 2);
});
