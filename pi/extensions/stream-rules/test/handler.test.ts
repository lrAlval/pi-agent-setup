/**
 * Handler-level E2E (deterministic): drives the real turn_end handler
 * with a stub pi. Proves A5 (exactly 1 correction then settles) and
 * A8 (/stream-rules off leaves the session untouched).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mod: { default: (pi: unknown) => void };
let handlers: Map<string, (e: never) => unknown>;
let commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
let renderers: Map<string, unknown>;

function stubPi() {
  handlers = new Map();
  commands = new Map();
  renderers = new Map();
  return {
    on: (ev: string, h: (e: never) => unknown) => {
      handlers.set(ev, h);
      return () => {};
    },
    registerCommand: (name: string, opts: { handler: (a: string, c: unknown) => Promise<void> }) => {
      commands.set(name, opts);
    },
    registerMessageRenderer: (t: string, r: unknown) => {
      renderers.set(t, r);
    },
    events: { on: () => () => {} },
  };
}

function turnEnd(text: string, outcome = "completed") {
  return {
    type: "turn_end",
    turnIndex: 3,
    outcome,
    message: { role: "assistant", content: text },
    toolResults: [],
    context: {
      llmMessages: [{ role: "assistant", content: text }],
      canContinue: true,
    },
  } as never;
}

function ctx() {
  const notes: string[] = [];
  return {
    seen: notes,
    mode: "print",
    hasUI: true,
    ui: { notify: (m: string) => void notes.push(m) },
  };
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "srules-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  writeFileSync(
    join(dir, "stream-rules.jsonl"),
    JSON.stringify({ name: "no-pineapple", regex: "pineapple", rule: "say mango instead" }) + "\n",
  );
  mod = (await import("../index.ts")) as typeof mod;
});

describe("stream-rules handler", () => {
  it("A5: induced phrase gets exactly 1 correction then settles", async () => {
    mod.default(stubPi());
    const h = handlers.get("turn_end");
    assert.ok(h, "turn_end handler registered");
    const first = h(turnEnd("I like pineapple pizza")) as { entries?: unknown[]; continue?: boolean } | undefined;
    assert.ok(first && Array.isArray(first.entries) && first.entries.length === 1);
    assert.equal(first.continue, true);
    const entry = first.entries[0] as { details: { kind: string; ruleName: string } };
    assert.equal(entry.details.kind, "stream-rule-correction");
    assert.equal(entry.details.ruleName, "no-pineapple");
    // Same turn again: settled, no second card.
    assert.equal(h(turnEnd("more pineapple")) as unknown, undefined);
    // New turn: fires once more.
    (handlers.get("turn_start") as (e: never) => unknown)({} as never);
    const again = h(turnEnd("pineapple again")) as { entries?: unknown[] } | undefined;
    assert.equal(again?.entries?.length, 1);
  });

  it("A8: off leaves the session untouched", async () => {
    mod.default(stubPi());
    const c = ctx();
    await commands.get("stream-rules")!.handler("off", c);
    assert.match(c.seen.join("\n"), /off/);
    const h = handlers.get("turn_end");
    assert.equal(h!(turnEnd("pineapple")) as unknown, undefined);
    await commands.get("stream-rules")!.handler("on", ctx());
    (handlers.get("turn_start") as (e: never) => unknown)({} as never);
    const back = h!(turnEnd("pineapple")) as { entries?: unknown[] } | undefined;
    assert.equal(back?.entries?.length, 1);
  });

  it("aborted outcome resets without forcing continue", () => {
    mod.default(stubPi());
    const h = handlers.get("turn_end");
    assert.equal(h!(turnEnd("pineapple", "aborted")) as unknown, undefined);
  });

  it("correction renderer registered under the stable key", () => {
    mod.default(stubPi());
    assert.ok(renderers.has("stream-rule-correction"));
  });
});
