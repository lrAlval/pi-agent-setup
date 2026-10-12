import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultEst, FALLBACK_EST_MIN, loadHistory, recordHistory, velocityRatio } from "../src/history.ts";

function tmpPath(): string {
	return join(tmpdir(), "pi-eta-test-" + process.pid + "-" + Math.floor(Math.random() * 1e9) + ".json");
}

describe("history", () => {
	it("missing file -> empty", () => assert.deepEqual(loadHistory(tmpPath()), []));
	it("roundtrip + invalid rows filtered", () => {
		const p = tmpPath();
		recordHistory({ estMin: 10, actualMin: 20, at: 1 }, p);
		recordHistory({ estMin: 10, actualMin: 30, at: 2 }, p);
		const loaded = loadHistory(p);
		assert.equal(loaded.length, 2);
		assert.equal(loaded[0].actualMin, 20);
	});
	it("velocity needs 3 samples", () => {
		assert.equal(velocityRatio([]), 1);
		assert.equal(velocityRatio([{ estMin: 10, actualMin: 20, at: 1 }]), 1);
		assert.equal(velocityRatio([
			{ estMin: 10, actualMin: 20, at: 1 },
			{ estMin: 10, actualMin: 30, at: 2 },
			{ estMin: 10, actualMin: 40, at: 3 },
		]), 3);
	});
	it("velocity clamped", () => {
		const recs = [1, 2, 3].map((i) => ({ estMin: 1, actualMin: 100, at: i }));
		assert.equal(velocityRatio(recs), 4);
	});
	it("defaultEst fallback + median", () => {
		assert.equal(defaultEst([]), FALLBACK_EST_MIN);
		assert.equal(defaultEst([{ estMin: 5, actualMin: 12, at: 1 }]), 12);
	});
});
