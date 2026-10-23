import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileRule } from "../rules.ts";
import { MAX_MATCHES, extractAssistantText, lastAssistantText, matchRules } from "../matcher.ts";

function rule(name: string, regex: string, extra = {}) {
  return compileRule({ name, regex, rule: `do ${name}`, ...extra });
}

describe("matcher", () => {
  it("same rule matching twice fires once when caller guards (cap)", () => {
    const r = [rule("nudge", "ticket")];
    const first = matchRules(r, "see ticket please", new Set());
    assert.equal(first.length, 1);
    // Second scan with the corrected set (as the handler maintains) = no fire.
    const second = matchRules(r, "see ticket please", new Set(["nudge"]));
    assert.equal(second.length, 0);
  });

  it("skips disabled rules", () => {
    const r = [rule("off", "ticket", { enabled: false })];
    assert.equal(matchRules(r, "ticket", new Set()).length, 0);
  });

  it("caps at 5 matches per message", () => {
    const rules = Array.from({ length: 8 }, (_, i) => rule(`r${i}`, `word${i}`));
    const text = rules.map((r) => r.regex).join(" ");
    const out = matchRules(rules, text, new Set());
    assert.equal(out.length, MAX_MATCHES);
  });

  it("scans tail of oversize messages", () => {
    const r = [rule("tail", "NEEDLE")];
    const text = "x".repeat(200_100) + " NEEDLE";
    const out = matchRules(r, text, new Set());
    assert.equal(out.length, 1);
    const missed = matchRules(r, "NEEDLE" + "x".repeat(200_100), new Set());
    assert.equal(missed.length, 0); // head-only hit is out of scan window
  });

  it("extracts text from string and block content", () => {
    assert.equal(extractAssistantText({ content: "hi" }), "hi");
    assert.equal(extractAssistantText({ content: [{ text: "a" }, { text: "b" }] }), "a\nb");
    assert.equal(extractAssistantText(null), "");
  });

  it("lastAssistantText picks the last assistant message", () => {
    const msgs = [
      { role: "assistant", content: "first" },
      { role: "user", content: "q" },
      { role: "assistant", content: [{ text: "second" }] },
    ];
    assert.equal(lastAssistantText(msgs), "second");
    assert.equal(lastAssistantText([]), "");
  });
});
