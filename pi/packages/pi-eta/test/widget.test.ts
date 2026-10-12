import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatusLine, buildWidgetLines } from "../src/widget.ts";

describe("widget", () => {
	it("empty plan", () => {
		const lines = buildWidgetLines({ tasks: [], nowMs: 0, velocity: 1 });
		assert.equal(lines.length, 1);
		assert.match(lines[0], /no plan/);
		assert.equal(buildStatusLine({ tasks: [], nowMs: 0, velocity: 1 }), "ETA: no plan");
	});
	it("progress line with counts + bar", () => {
		const lines = buildWidgetLines({
			tasks: [
				{ id: 1, subject: "done task", status: "completed", estMin: 10 },
				{ id: 2, subject: "todo task", status: "pending", estMin: 20 },
			],
			nowMs: 0, velocity: 1,
		});
		assert.equal(lines.length, 1);
		assert.match(lines[0], /ETA ~20m · 1\/2/);
	});
	it("current task second line", () => {
		const lines = buildWidgetLines({
			tasks: [{ id: 1, subject: "writing tests", status: "in_progress", estMin: 10, startedAtMs: 0 }],
			nowMs: 5 * 60_000, velocity: 1,
		});
		assert.equal(lines.length, 2);
		assert.match(lines[0], /ETA ~5m/);
		assert.match(lines[1], /now: writing tests \(5m elapsed\)/);
	});
});
