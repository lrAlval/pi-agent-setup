import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateOf, parseTodoDetails } from "../src/rpiv.ts";

describe("rpiv parse", () => {
	it("rejects non-shapes", () => {
		assert.equal(parseTodoDetails(undefined), undefined);
		assert.equal(parseTodoDetails({}), undefined);
		assert.equal(parseTodoDetails({ tasks: "x" }), undefined);
	});
	it("parses tasks, skips invalid rows", () => {
		const got = parseTodoDetails({ tasks: [{ id: 1, subject: "a", status: "pending", metadata: { est_minutes: 15 } }, { nope: true }] });
		assert.equal(got?.length, 1);
		assert.equal(got?.[0].subject, "a");
	});
	it("estimateOf reads metadata.est_minutes", () => {
		assert.equal(estimateOf({ id: 1, subject: "a", status: "pending", metadata: { est_minutes: 15 } }), 15);
		assert.equal(estimateOf({ id: 1, subject: "a", status: "pending" }), undefined);
		assert.equal(estimateOf({ id: 1, subject: "a", status: "pending", metadata: { est_minutes: -3 } }), undefined);
		assert.equal(estimateOf({ id: 1, subject: "a", status: "pending", metadata: { est_minutes: "soon" } }), undefined);
	});
});
