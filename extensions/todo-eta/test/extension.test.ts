import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("persistent widget exists only during open work while command remains available", async () => {
  const listeners = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>();
  const tools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> = [];
  const widgetCalls: Array<[string, unknown]> = [];
  const notifications: string[] = [];
  const api = {
    registerTool: (tool: typeof tools[number]) => tools.push(tool),
    registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }) => commands.set(name, command),
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => listeners.set(name, handler),
    appendEntry: () => "entry",
  } as unknown as ExtensionAPI;
  todoEtaExtension(api);
  const ctx = {
    hasUI: true,
    mode: "inline",
    sessionManager: { getBranch: () => [] },
    ui: {
      setWidget: (key: string, widget: unknown) => widgetCalls.push([key, widget]),
      notify: (message: string) => notifications.push(message),
    },
  } as unknown as ExtensionContext;

  await listeners.get("session_start")?.({}, ctx);
  assert.deepEqual(widgetCalls.at(-1), ["todo-eta", undefined]);
  const tool = tools[0];
  await tool.execute("call", { action: "apply", ops: [{ op: "create", ref: "work", title: "Work", estimateMin: 5, start: true }] }, undefined, undefined, ctx);
  assert.equal(widgetCalls.at(-1)?.[0], "todo-eta");
  assert.notEqual(widgetCalls.at(-1)?.[1], undefined);
  const id = widgetCalls.length;
  await tool.execute("call", { action: "apply", ops: [{ op: "complete", ref: 1 }] }, undefined, undefined, ctx);
  assert.deepEqual(widgetCalls.at(-1), ["todo-eta", undefined]);
  assert.ok(widgetCalls.length > id);

  await commands.get("todo-eta")?.handler("", ctx);
  assert.match(notifications.at(-1) ?? "", /1\/1 tasks/);
});

test("publishes partial history only when session shutdown reason is quit", async () => {
  const previousDir = process.env.PI_TODO_ETA_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "todo-eta-shutdown-"));
  try {
    for (const reason of ["quit", "new", "resume", "fork", "reload"] as const) {
      const dir = join(root, reason);
      process.env.PI_TODO_ETA_STATE_DIR = dir;
      const listeners = new Map<string, (event: any, ctx: ExtensionContext) => Promise<void> | void>();
      const tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }> = [];
      const api = {
        registerTool: (tool: typeof tools[number]) => tools.push(tool),
        registerCommand: () => {},
        on: (name: string, handler: (event: any, ctx: ExtensionContext) => Promise<void> | void) => listeners.set(name, handler),
        appendEntry: () => "entry",
      } as unknown as ExtensionAPI;
      todoEtaExtension(api);
      const ctx = { hasUI: false, sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext;
      await listeners.get("session_start")?.({}, ctx);
      await tools[0].execute("call", { action: "apply", ops: [{ op: "create", ref: "work", title: "Work", estimateMin: 2, start: true }] }, undefined, undefined, ctx);
      await listeners.get("agent_start")?.({}, ctx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (reason === "fork") await listeners.get("session_before_fork")?.({ type: "session_before_fork", entryId: "entry", position: "before" }, ctx);
      await listeners.get("session_shutdown")?.({ type: "session_shutdown", reason }, ctx);
      const files = await readdir(dir).catch(() => []);
      assert.equal(files.filter((file) => file.endsWith(".json")).length, reason === "quit" ? 1 : 0, `${reason} shutdown`);
    }
  } finally {
    if (previousDir === undefined) delete process.env.PI_TODO_ETA_STATE_DIR;
    else process.env.PI_TODO_ETA_STATE_DIR = previousDir;
    await rm(root, { recursive: true, force: true });
  }
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
