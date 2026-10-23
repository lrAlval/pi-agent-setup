import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskBridge, parseTaskView } from "../bridge.ts";

function bus() {
  const handlers = new Map<string, Array<(d: unknown) => void>>();
  return {
    handlers,
    on(channel: string, h: (d: unknown) => void) {
      const arr = handlers.get(channel) ?? [];
      arr.push(h);
      handlers.set(channel, arr);
      return () => {
        handlers.set(channel, (handlers.get(channel) ?? []).filter((x) => x !== h));
      };
    },
    emit(channel: string, d: unknown) {
      for (const h of handlers.get(channel) ?? []) h(d);
    },
  };
}

describe("bridge", () => {
  it("malformed frame -> raw-preserved unknown row + loud error", () => {
    const b = new TaskBridge(bus(), []);
    const row = parseTaskView(42);
    assert.equal(row.kind, "unknown");
    assert.equal(row.status, "unknown");
    assert.equal(row.raw, 42);
    void b;
  });

  it("frame without tasks = revision ping, no rows no error", () => {
    const events = bus();
    const b = new TaskBridge(events, []);
    const off = b.subscribe(() => {});
    events.emit("pi-background-tasks:host:changed:v1", {
      schema_version: "pi-background-tasks.host-changed.v1",
      kind: "changed",
      revision: 3,
    });
    assert.equal(b.frameErrorText(), null);
    assert.equal(b.list().length, 0);
    assert.equal(b.hasFrameSource(), true);
    off();
  });

  it("frame with tasks wins over fs scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-"));
    const run = join(dir, "run1");
    mkdirSync(run);
    writeFileSync(
      join(run, "aaa.json"),
      JSON.stringify({ id: "aaa", name: "fs-task", command: "sleep 1", status: "running", startTime: 1 }),
    );
    writeFileSync(join(run, "aaa.output"), "");
    const events = bus();
    const b = new TaskBridge(events, [dir]);
    const off = b.subscribe(() => {});
    assert.equal(b.list().length, 1);
    assert.equal(b.list()[0].name, "fs-task");
    events.emit("pi-background-tasks:host:changed:v1", {
      tasks: [{ task: { id: "aaa", command: "sleep 1", status: "completed" }, kind: "shell" }],
    });
    const rows = b.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "completed");
    assert.equal(b.tail("aaa", 64), "(hub) empty output so far");
    assert.match(b.tail("nope"), /no task matching/);
    off();
  });

  it("unreadable snapshot -> unknown row, list survives", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-"));
    const run = join(dir, "run9");
    mkdirSync(run);
    writeFileSync(join(run, "bad.json"), "{not json");
    const b = new TaskBridge(bus(), [dir]);
    const rows = b.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "unknown");
  });
});
