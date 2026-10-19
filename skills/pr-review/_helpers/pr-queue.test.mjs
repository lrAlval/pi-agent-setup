import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDependencies, parseSpecPresent, orderQueue } from "./pr-queue.mjs";

const Q = (over = {}) => ({
  number: 1, title: "t", labels: [], ci: "none", ageDays: 0, dependsOn: [], specPresent: false, ...over,
});

test("parseDependencies: all 3 markers, case-insensitive", () => {
  assert.deepEqual(parseDependencies("Depends on #5 and #6"), [5, 6]);
  assert.deepEqual(parseDependencies("blocked by #7"), [7]);
  assert.deepEqual(parseDependencies("STACKED ON #8"), [8]);
});

test("parseDependencies: mixed, duplicates, empty/null", () => {
  assert.deepEqual(parseDependencies("Depends on #5, #5, blocked by #9"), [5, 9]);
  assert.deepEqual(parseDependencies(""), []);
  assert.deepEqual(parseDependencies(null), []);
  assert.deepEqual(parseDependencies(undefined), []);
});

test("parseDependencies: no false hits on bare #123", () => {
  assert.deepEqual(parseDependencies("Fixes #123, see also #456"), []);
});

test("parseSpecPresent: fenced / heading / Spec: / none", () => {
  assert.equal(parseSpecPresent("```js\ncode\n```"), true);
  assert.equal(parseSpecPresent("## Spec\nstuff"), true);
  assert.equal(parseSpecPresent("## SPEC\nstuff"), true);
  assert.equal(parseSpecPresent("Spec: implement X"), true);
  assert.equal(parseSpecPresent("just a title"), false);
  assert.equal(parseSpecPresent(""), false);
});

test("orderQueue: single PR", () => {
  const { order } = orderQueue([Q({ number: 3 })]);
  assert.deepEqual(order, [3]);
});

test("orderQueue: dependency first, why mentions dependents", () => {
  const { order, why } = orderQueue([Q({ number: 10, dependsOn: [5] }), Q({ number: 5 })]);
  assert.deepEqual(order, [5, 10]);
  assert.match(why[5], /depend on it/);
});

test("orderQueue: critical label beats plain", () => {
  const { order } = orderQueue([Q({ number: 1 }), Q({ number: 2, labels: ["critical"] })]);
  assert.deepEqual(order, [2, 1]);
});

test("orderQueue: CI failing beats passing", () => {
  const { order } = orderQueue([Q({ number: 1, ci: "passing" }), Q({ number: 2, ci: "failing" })]);
  assert.deepEqual(order, [2, 1]);
});

test("orderQueue: full tie -> lower number", () => {
  const { order } = orderQueue([Q({ number: 9 }), Q({ number: 4 })]);
  assert.deepEqual(order, [4, 9]);
});

test("orderQueue: cycle does not hang, ranked by summed dependents", () => {
  const { order } = orderQueue([Q({ number: 1, dependsOn: [2] }), Q({ number: 2, dependsOn: [1] })]);
  assert.deepEqual(new Set(order), new Set([1, 2]));
  assert.equal(order.length, 2);
});

test("orderQueue: unknown dep ignored with note", () => {
  const { order, why } = orderQueue([Q({ number: 1, dependsOn: [999] })]);
  assert.deepEqual(order, [1]);
  assert.match(why[1], /unknown dep #999 ignored/);
});
