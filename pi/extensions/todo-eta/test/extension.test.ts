import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import todoEtaExtension, { reconstructFromSession } from "../src/index.ts";

test("session reconstruction reads active branch only", () => {
  const state = { tasks: [], nextId: 2, activeId: null };
  const timing = { v: 1, taskId: null, measuredMs: 4, runActive: false, intervalStartMs: null, status: "paused", eligible: false };
  const entries = [
    { type: "message", message: { role: "toolResult", toolName: "todo_eta", details: { v: 1, state: { ...state, nextId: 1 } } } },
    { type: "message", message: { role: "toolResult", toolName: "todo_eta", details: { v: 1, state } } },
    { type: "custom", customType: "todo-eta-timing", data: timing },
  ];
  const abandonedState = { ...state, nextId: 99 };
  const restored = reconstructFromSession({ sessionManager: { getBranch: () => entries, getEntries: () => [{ type: "message", message: { role: "toolResult", toolName: "todo_eta", details: { v: 1, state: abandonedState } } }] } });
  assert.deepEqual(restored.state, state);
  assert.deepEqual(restored.timing, timing);
});

test("registers one todo_eta tool and returns atomic failures as errors", async () => {
  const tools: Array<{ name: string }> = [];
  const api = {
    registerTool: (tool: { name: string }) => tools.push(tool),
    registerCommand: () => {},
    on: () => {},
    appendEntry: () => "entry",
  } as unknown as ExtensionAPI;
  todoEtaExtension(api);
  assert.deepEqual(tools.map((tool) => tool.name), ["todo_eta"]);
  assert.equal((tools[0] as { executionMode?: string }).executionMode, "sequential");
  const tool = tools[0] as unknown as { execute: (...args: unknown[]) => Promise<{ details: { error?: string; state: { tasks: unknown[] } }; isError?: boolean }> };
  const result = await tool.execute("call", { action: "apply", ops: [{ op: "start", ref: 99 }] }, undefined, undefined, { hasUI: false } as ExtensionContext);
  assert.equal(result.isError, true);
  assert.match(result.details.error ?? "", /unknown task/i);
  assert.deepEqual(result.details.state.tasks, []);
});
