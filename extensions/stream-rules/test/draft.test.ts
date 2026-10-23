import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileRule } from "../rules.ts";
import {
  CORRECTION_CUSTOM_TYPE,
  CORRECTION_KIND,
  buildCorrectionDetails,
  renderRuleCorrection,
} from "../renderer.ts";

describe("draft shape", () => {
  it("details carry stable contract fields", () => {
    const rule = compileRule({ name: "n", regex: "x", rule: "do n", maxCorrections: 2 });
    const d = buildCorrectionDetails({ rule, matchIndex: 0, excerpt: "x" });
    assert.equal(d.kind, "stream-rule-correction");
    assert.equal(d.kind, CORRECTION_KIND);
    assert.equal(d.ruleName, "n");
    assert.equal(d.ruleText, "do n");
    assert.equal(d.maxCorrections, 2);
    assert.ok(typeof d.timestamp === "string");
  });

  it("custom type key is stable for the renderer", () => {
    assert.equal(CORRECTION_CUSTOM_TYPE, "stream-rule-correction");
  });

  it("card is one compact line per rule in file order", () => {
    const a = compileRule({ name: "a", regex: "x", rule: "first" });
    const b = compileRule({ name: "b", regex: "y", rule: "second" });
    const card = renderRuleCorrection(
      [
        { rule: a, matchIndex: 0, excerpt: "" },
        { rule: b, matchIndex: 1, excerpt: "" },
      ],
      7,
    );
    const lines = card.split("\n");
    assert.ok(lines[0].startsWith("[rule] a: first (match 1 of 1)"));
    assert.ok(lines[1].startsWith("[rule] b: second (match 2 of 1)"));
    assert.ok(card.includes("turn 7"));
  });
});
