import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LEDGER = "/home/aiden/.agents/skills/pr-review/_helpers/ledger.mjs";
const run = (args) => execFileSync("node", [LEDGER, ...args], { encoding: "utf8" });
const runErr = (args) => {
  try { run(args); assert.fail("should throw"); }
  catch (e) { return e; }
};
function tmp() {
  const d = join(tmpdir(), `ledger-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}
// AC1: upsert merge keeps status, updates line+lastSeen, no dup
test("AC1 upsert merge preserves status", () => {
  const d = tmp();
  const L = join(d, "l.json"), F1 = join(d, "f1.json"), F2 = join(d, "f2.json");
  writeFileSync(F1, JSON.stringify({ findings: [{ file: "a.cjs", line: 10, check: "c1", severity: "high" }] }));
  run(["upsert", L, F1, "--sha", "aaa"]);
  let l = JSON.parse(readFileSync(L, "utf8"));
  assert.equal(l.findings.length, 1);
  assert.equal(l.findings[0].status, "open");
  const id = l.findings[0].id;
  run(["mark", L, id, "wontfix", "--sha", "aaa"]);
  writeFileSync(F2, JSON.stringify({ findings: [{ file: "a.cjs", line: 12, check: "c1", severity: "high" }] }));
  run(["upsert", L, F2, "--sha", "bbb"]);
  l = JSON.parse(readFileSync(L, "utf8"));
  assert.equal(l.findings.length, 1);
  assert.equal(l.findings[0].id, id);
  assert.equal(l.findings[0].line, 12);
  assert.equal(l.findings[0].status, "wontfix");
  assert.equal(l.findings[0].lastSeenSha, "bbb");
  rmSync(d, { recursive: true, force: true });
});
// AC2: drift>3 appends fresh f002 open
test("AC2 line drift appends new id", () => {
  const d = tmp();
  const L = join(d, "l.json"), F1 = join(d, "f1.json"), F2 = join(d, "f2.json");
  writeFileSync(F1, JSON.stringify({ findings: [{ file: "a.cjs", line: 10, check: "c1", severity: "high" }] }));
  run(["upsert", L, F1, "--sha", "aaa"]);
  writeFileSync(F2, JSON.stringify({ findings: [{ file: "a.cjs", line: 50, check: "c1", severity: "high" }] }));
  run(["upsert", L, F2, "--sha", "bbb"]);
  const l = JSON.parse(readFileSync(L, "utf8"));
  assert.equal(l.findings.length, 2);
  assert.equal(l.findings[1].status, "open");
  rmSync(d, { recursive: true, force: true });
});
// AC3: diff classifies
test("AC3 diff classifies new/persistent/fixed", () => {
  const d = tmp();
  const L = join(d, "l.json"), F1 = join(d, "f1.json"), F2 = join(d, "f2.json");
  writeFileSync(F1, JSON.stringify({ findings: [
    { file: "a.cjs", line: 10, check: "c1", severity: "high" },
    { file: "b.cjs", line: 5, check: "c2", severity: "low" },
  ]}));
  run(["upsert", L, F1, "--sha", "aaa"]);
  writeFileSync(F2, JSON.stringify({ findings: [
    { file: "a.cjs", line: 11, check: "c1", severity: "high" },
    { file: "c.cjs", line: 1, check: "c3", severity: "medium" },
  ]}));
  const out = JSON.parse(run(["diff", L, F2]));
  assert.equal(out.persistent.length, 1);
  assert.equal(out.fixed.length, 1);
  assert.equal(out.new.length, 1);
  rmSync(d, { recursive: true, force: true });
});
// AC4: mark transitions + exit5
test("AC4 mark + exit5 unknown", () => {
  const d = tmp();
  const L = join(d, "l.json"), F1 = join(d, "f1.json");
  writeFileSync(F1, JSON.stringify({ findings: [{ file: "a.cjs", line: 1, check: "c1", severity: "low" }] }));
  run(["upsert", L, F1, "--sha", "aaa"]);
  const l0 = JSON.parse(readFileSync(L, "utf8"));
  run(["mark", L, l0.findings[0].id, "fixed", "--sha", "bbb"]);
  const l1 = JSON.parse(readFileSync(L, "utf8"));
  assert.equal(l1.findings[0].status, "fixed");
  const e = runErr(["mark", L, "f999", "fixed", "--sha", "bbb"]);
  assert.equal(e.status, 5);
  rmSync(d, { recursive: true, force: true });
});
// AC5: render self-contained escaped
test("AC5 render escaped self-contained", () => {
  const d = tmp();
  const L = join(d, "l.json"), F1 = join(d, "f1.json"), H = join(d, "o.html");
  writeFileSync(F1, JSON.stringify({ findings: [{ file: "a.cjs", line: 1, check: "c<x>", severity: "low", note: "<b>&" }] }));
  run(["upsert", L, F1, "--sha", "aaa"]);
  run(["render", L, H]);
  const h = readFileSync(H, "utf8");
  assert.match(h, /&lt;x&gt;/);
  assert.match(h, /&lt;b&gt;&amp;/);
  assert.doesNotMatch(h, /http:\/\/|https:\/\//);
  rmSync(d, { recursive: true, force: true });
});
