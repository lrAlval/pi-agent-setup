import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeEta, formatEta, isDone, median } from "../src/eta.ts";

describe("median", () => {
	it("empty -> 0", () => assert.equal(median([]), 0));
	it("odd", () => assert.equal(median([3, 1, 2]), 2));
	it("even", () => assert.equal(median([4, 1, 3, 2]), 2.5));
});

describe("isDone", () => {
	it("completed/deleted done", () => { assert.ok(isDone("completed")); assert.ok(isDone("deleted")); });
	it("pending/in_progress not done", () => { assert.ok(!isDone("pending")); assert.ok(!isDone("in_progress")); });
});

describe("computeEta", () => {
	it("sums pending estimates", () => {
		const r = computeEta([
			{ id: 1, subject: "a", status: "pending", estMin: 10 },
			{ id: 2, subject: "b", status: "pending", estMin: 20 },
		], 0, 1);
		assert.equal(r.total, 2); assert.equal(r.done, 0); assert.equal(r.remainingMin, 30);
	});
	it("excludes done", () => {
		const r = computeEta([
			{ id: 1, subject: "a", status: "completed", estMin: 10 },
			{ id: 2, subject: "b", status: "pending", estMin: 20 },
		], 0, 1);
		assert.equal(r.done, 1); assert.equal(r.remainingMin, 20);
	});
	it("in_progress subtracts elapsed, clamps at 0", () => {
		const start = 1_000_000;
		const r = computeEta([{ id: 1, subject: "a", status: "in_progress", estMin: 10, startedAtMs: start }], start + 4 * 60_000, 1);
		assert.equal(r.remainingMin, 6);
		assert.equal(r.current?.subject, "a");
		const over = computeEta([{ id: 1, subject: "a", status: "in_progress", estMin: 10, startedAtMs: start }], start + 30 * 60_000, 1);
		assert.equal(over.remainingMin, 0);
	});
	it("scales by velocity", () => {
		const r = computeEta([{ id: 1, subject: "a", status: "pending", estMin: 10 }], 0, 1.5);
		assert.equal(r.remainingMin, 15);
	});
});

describe("formatEta", () => {
	it("formats", () => {
		assert.equal(formatEta(0.2), "<1m");
		assert.equal(formatEta(14), "~14m");
		assert.equal(formatEta(60), "~1h");
		assert.equal(formatEta(90), "~1h30m");
	});
});
