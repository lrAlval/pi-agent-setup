import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { initialTaskState, applyBatch } from "../src/tasks.ts";
import { renderWidgetLines, truncateToWidth } from "../src/widget.ts";

test("widget renders active, ready, blocked and stays within six lines", () => {
  let state = applyBatch(initialTaskState(), [
    { op: "create", ref: "a", title: "Active task", estimateMin: 5, start: true },
    { op: "create", ref: "b", title: "Ready task", estimateMin: 4 },
    { op: "create", ref: "c", title: "Blocked task", estimateMin: 3, deps: ["a"] },
  ]).state;
  state.tasks[1].blockerReason = "waiting";
  const lines = renderWidgetLines({ state, paused: true });
  assert.ok(lines[0].startsWith("▶"));
  assert.ok(lines.some((line) => line.startsWith("↳")));
  assert.ok(lines.length <= 6);
});

test("widget truncates by terminal width", () => {
  assert.equal(stripTerminalSequences(truncateToWidth("abcdefgh", 5)), "abcd…");
  assert.ok(visibleWidth(truncateToWidth("你a", 2)) <= 2);
});
