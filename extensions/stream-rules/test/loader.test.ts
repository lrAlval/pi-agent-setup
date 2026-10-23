import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadRulesFromText, parseRuleLine } from "../rules.ts";

describe("loader", () => {
  it("loads valid rules", () => {
    const { rules, errors } = loadRulesFromText(
      '{"name":"a","regex":"foo","rule":"say bar"}\n{"name":"b","regex":"x+","rule":"r2","maxCorrections":3,"enabled":false}\n',
      "test",
    );
    assert.equal(errors.length, 0);
    assert.equal(rules.length, 2);
    assert.equal(rules[0].maxCorrections, 1); // default
    assert.equal(rules[0].enabled, true);
    assert.equal(rules[1].maxCorrections, 3);
    assert.equal(rules[1].enabled, false);
  });

  it("surfaces invalid rows as errors, keeps loading", () => {
    const { rules, errors } = loadRulesFromText(
      [
        '{"name":"good","regex":"ok","rule":"r"}',
        "not json",
        '{"name":"x"}',
        '{"name":"badre","regex":"([","rule":"r"}',
        "",
        "[]",
      ].join("\n"),
      "test",
    );
    assert.equal(rules.length, 1);
    assert.equal(rules[0].name, "good");
    assert.equal(errors.length, 3);
    assert.ok(errors.every((e) => e.src === "test" && e.lineNo >= 1));
  });

  it("empty input = zero rules, zero errors", () => {
    const { rules, errors } = loadRulesFromText("", "test");
    assert.equal(rules.length, 0);
    assert.equal(errors.length, 0);
  });

  it("parseRuleLine rejects non-objects", () => {
    assert.ok("error" in parseRuleLine("[1,2]", "s", 1));
    assert.ok("error" in parseRuleLine('"str"', "s", 1));
  });
});
