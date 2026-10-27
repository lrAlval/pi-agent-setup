// Lifecycle regression tests for Pringled forks.
// Loads actual vendored TypeScript entrypoints through Pi API/model seams.
// Run: node --test tests/pringled-lifecycle.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./pi-stubs-loader.mjs", import.meta.url);

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function deferredAnswer(text) {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {
    promise,
    resolveWith: (t = text) => resolve({ stopReason: "stop", content: [{ type: "text", text: t }] }),
    rejectWith: reject,
  };
}

function makePi() {
  const handlers = {};
  const commands = {};
  return {
    handlers,
    commands,
    on(event, fn) { (handlers[event] ??= []).push(fn); },
    registerCommand(name, def) { commands[name] = def; },
    getThinkingLevel: () => "off",
    async emit(event, payload, ctx) {
      for (const fn of handlers[event] ?? []) await fn(payload, ctx);
    },
  };
}

function makeUi() {
  const widgets = new Map();
  let editorFactory;
  return {
    widgets,
    lastRenders: 0,
    setWidget(name, renderer) {
      if (renderer === undefined) widgets.delete(name);
      else widgets.set(name, renderer);
    },
    getEditorComponent: () => undefined,
    setEditorComponent: (fn) => { editorFactory = fn; },
    makeEditor() {
      assert.ok(editorFactory, "editor factory not registered (session_start missing?)");
      const tui = { requestRender: () => {} };
      return editorFactory(tui, {}, {});
    },
    theme: { fg: (_c, s) => String(s) },
    notify: () => {},
  };
}

function widgetText(ui, name, width = 80) {
  const w = ui.widgets.get(name);
  if (!w) return undefined;
  const inst = w(null, ui.theme);
  return inst.render(width).join("\n");
}

function makeCtx(ui, modelCalls) {
  const model = { reasoning: false };
  return {
    mode: "tui",
    model,
    hasPendingMessages: () => false,
    waitForIdle: async () => {},
    modelRegistry: {
      streamSimple(_m, _ctx, { signal } = {}) {
        const d = deferredAnswer("");
        d.signal = signal;
        modelCalls.push(d);
        return { result: () => d.promise };
      },
    },
    sessionManager: {
      getSessionId: () => "test-session",
      buildSessionProjection: () => ({ messages: [] }),
      getBranch: () => [1, 2, 3].map(() => ({ type: "message", message: { role: "user" } })),
    },
    ui,
  };
}

const assistantEnd = () => ({
  messages: [{ role: "assistant", stopReason: "stop", content: [] }],
});

// --- next-prompt ---

test("next-prompt: typing dismisses pending suggestion (late response stays dismissed)", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-next-prompt/extensions/next-prompt.ts")).default(pi);

  await pi.emit("session_start", {}, ctx);
  const editor = ui.makeEditor();
  await pi.emit("agent_end", assistantEnd(), ctx);
  assert.equal(calls.length, 1, "expected one suggestion request");
  // user types before the model answers, then clears the editor
  editor.handleInput("x");
  editor.setText("");
  calls[0].resolveWith("approve the plan");
  await tick(20);
  const lines = editor.render(40);
  assert.ok(!lines[1].includes("approve the plan"), "stale suggestion repopulated after typing dismiss");
  assert.ok(calls[0].signal.aborted, "pending request was not aborted on typing dismiss");
});

test("next-prompt: shutdown prevents late suggestion", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-next-prompt/extensions/next-prompt.ts")).default(pi);

  await pi.emit("session_start", {}, ctx);
  const editor = ui.makeEditor();
  await pi.emit("agent_end", assistantEnd(), ctx);
  assert.equal(calls.length, 1);
  await pi.emit("session_shutdown", {}, ctx);
  calls[0].resolveWith("approve the plan");
  await tick(20);
  const lines = editor.render(40);
  assert.ok(!lines[1].includes("approve the plan"), "suggestion appeared after shutdown");
});

// --- heads-up ---

test("heads-up: agent_start cancels pending note", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-heads-up/extensions/heads-up.ts")).default(pi);

  const end = {
    messages: [
      { role: "toolResult" }, { role: "toolResult" }, { role: "toolResult" },
      { role: "assistant", stopReason: "stop", content: [] },
    ],
  };
  await pi.emit("agent_end", end, ctx);
  assert.equal(calls.length, 1);
  await pi.emit("agent_start", {}, ctx);
  calls[0].resolveWith("you missed a tradeoff");
  await tick(20);
  assert.equal(widgetText(ui, "heads-up"), undefined, "stale heads-up note shown after reset");
  assert.ok(calls[0].signal.aborted, "pending heads-up request was not aborted on reset");
});

test("heads-up: shutdown prevents late widget update", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-heads-up/extensions/heads-up.ts")).default(pi);

  const end = {
    messages: [
      { role: "toolResult" }, { role: "toolResult" }, { role: "toolResult" },
      { role: "assistant", stopReason: "stop", content: [] },
    ],
  };
  await pi.emit("agent_end", end, ctx);
  assert.equal(calls.length, 1);
  await pi.emit("session_shutdown", {}, ctx);
  calls[0].resolveWith("you missed a tradeoff");
  await tick(20);
  assert.equal(widgetText(ui, "heads-up"), undefined, "heads-up widget updated after shutdown");
});

test("heads-up: second agent_end supersedes first request", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-heads-up/extensions/heads-up.ts")).default(pi);

  const end = () => ({
    messages: [
      { role: "toolResult" }, { role: "toolResult" }, { role: "toolResult" },
      { role: "assistant", stopReason: "stop", content: [] },
    ],
  });
  await pi.emit("agent_end", end(), ctx);
  await pi.emit("agent_end", end(), ctx);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].signal.aborted, "first heads-up request was not aborted by second run");
  calls[0].resolveWith("first note");
  await tick(20);
  assert.equal(widgetText(ui, "heads-up"), undefined, "superseded first note was shown");
  calls[1].resolveWith("second note");
  await tick(20);
  assert.match(widgetText(ui, "heads-up") ?? "", /second note/);
});

// --- away ---

test("away: overlapping /recap keeps latest result (stale cannot overwrite)", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-away/extensions/away.ts")).default(pi);

  const p1 = pi.commands.recap.handler([], ctx);
  const p2 = pi.commands.recap.handler([], ctx);
  await tick(10);
  assert.equal(calls.length, 2, "expected two concurrent recap requests");
  // newest resolves first, then the stale one resolves late
  calls[1].resolveWith("second recap");
  await tick(10);
  calls[0].resolveWith("first recap");
  await p1;
  await p2;
  await tick(10);
  const text = widgetText(ui, "recap") ?? "";
  assert.match(text, /second recap/, "latest recap was not kept");
  assert.doesNotMatch(text, /first recap/, "stale recap overwrote newer result");
});

test("away: second agent_end replaces pending timer (no double recap)", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-away/extensions/away.ts")).default(pi);

  const scheduled = [];
  const origSet = globalThis.setTimeout;
  const origClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = origSet(fn, ms, ...rest);
    scheduled.push(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const i = scheduled.indexOf(id);
    if (i >= 0) scheduled.splice(i, 1);
    return origClear(id);
  };
  try {
    await pi.emit("agent_end", assistantEnd(), ctx);
    await pi.emit("agent_end", assistantEnd(), ctx);
    assert.equal(scheduled.length, 1, `expected 1 pending timer, got ${scheduled.length}`);
  } finally {
    globalThis.setTimeout = origSet;
    globalThis.clearTimeout = origClear;
    for (const id of scheduled) origClear(id);
  }
});

test("away: shutdown cancels timer and pending recap (no stale UI update)", async () => {
  const pi = makePi();
  const ui = makeUi();
  const calls = [];
  const ctx = makeCtx(ui, calls);
  (await import("../packages/pi-away/extensions/away.ts")).default(pi);

  const scheduled = [];
  const origSet = globalThis.setTimeout;
  const origClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = origSet(fn, ms, ...rest);
    scheduled.push(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const i = scheduled.indexOf(id);
    if (i >= 0) scheduled.splice(i, 1);
    return origClear(id);
  };
  try {
    await pi.emit("agent_end", assistantEnd(), ctx);
    await pi.emit("session_shutdown", {}, ctx);
    assert.equal(scheduled.length, 0, "timer survived shutdown");
    const p = pi.commands.recap.handler([], ctx);
    await tick(10);
    const last = calls.at(-1);
    assert.ok(last, "expected a recap request");
    await pi.emit("session_shutdown", {}, ctx);
    assert.ok(last.signal.aborted, "pending recap was not aborted on shutdown");
    last.resolveWith("late recap");
    await p;
    await tick(10);
    const text = widgetText(ui, "recap") ?? "";
    assert.doesNotMatch(text, /late recap/, "recap published after shutdown");
  } finally {
    globalThis.setTimeout = origSet;
    globalThis.clearTimeout = origClear;
    for (const id of scheduled) origClear(id);
  }
});
