import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import piEta from "../src/index.ts";
import { loadHistory } from "../src/history.ts";

function tmp(name: string): string {
	return join(tmpdir(), "pi-eta-idx-" + process.pid + "-" + name + ".json");
}

let HIST = "";
let ACTIVE = "";

function makePi() {
	const handlers: Record<string, Function> = {};
	const emitted: Array<[string, unknown]> = [];
	const commands: Record<string, { handler: Function }> = {};
	const pi = {
		on: (ev: string, h: Function) => { handlers[ev] = h; },
		events: { emit: (ch: string, data: unknown) => { emitted.push([ch, data]); } },
		registerCommand: (name: string, def: { handler: Function }) => { commands[name] = def; },
	};
	return { pi, handlers, emitted, commands };
}

function makeCtx(sid: string, entries: unknown[] = []) {
	const widgets: Array<[string, string[] | undefined]> = [];
	const statuses: Array<[string, string | undefined]> = [];
	const notified: string[] = [];
	return {
		hasUI: true,
		widgets, statuses, notified,
		sessionManager: { getSessionId: () => sid, getEntries: () => entries, getBranch: () => entries },
		ui: {
			setWidget: (k: string, c: string[] | undefined) => { widgets.push([k, c]); },
			setStatus: (k: string, c: string | undefined) => { statuses.push([k, c]); },
			notify: (m: string) => { notified.push(m); },
		},
	};
}

function todoDetails(tasks: unknown[]) {
	return { action: "list", params: {}, tasks, nextId: 99 };
}
function customEntry(tasks: unknown[]) {
	return { type: "custom", customType: "rpiv-todo-state", data: todoDetails(tasks) };
}
function toolMsg(tasks: unknown[]) {
	return { type: "message", message: { role: "toolResult", toolName: "todo", details: todoDetails(tasks) } };
}

describe("index wiring", () => {
	beforeEach(() => {
		HIST = tmp("h" + Math.floor(Math.random() * 1e9));
		ACTIVE = tmp("a" + Math.floor(Math.random() * 1e9));
		process.env.PI_ETA_HISTORY = HIST;
		process.env.PI_ETA_ACTIVE = ACTIVE;
	});

	it("guideline injected once, covers sandbox", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const opts = { promptGuidelines: [] as string[] };
		handlers["before_agent_start"]({ systemPromptOptions: opts });
		handlers["before_agent_start"]({ systemPromptOptions: opts });
		assert.equal(opts.promptGuidelines.length, 1);
		assert.match(opts.promptGuidelines[0], /est_minutes/);
		assert.match(opts.promptGuidelines[0], /tools\.todo/);
	});

	it("tool_call create injects missing estimate", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-call");
		const input: Record<string, unknown> = { action: "create", subject: "x" };
		handlers["tool_call"]({ toolName: "todo", input }, ctx);
		assert.equal((input.metadata as Record<string, unknown>).est_minutes, 10);
	});

	it("tool_call keeps agent estimate", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-call2");
		const input: Record<string, unknown> = { action: "create", subject: "x", metadata: { est_minutes: 42 } };
		handlers["tool_call"]({ toolName: "todo", input }, ctx);
		assert.equal((input.metadata as Record<string, unknown>).est_minutes, 42);
	});

	it("tool_result updates widget + emits event + snapshots active", () => {
		const { pi, handlers, emitted } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-res");
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 1, subject: "a", status: "in_progress" }]) }, ctx);
		assert.ok(ctx.widgets.length > 0);
		assert.match(ctx.widgets[ctx.widgets.length - 1][1]![0], /ETA/);
		const evt = emitted.find(([ch]) => ch === "pi-eta:eta");
		assert.ok(evt);
		assert.equal((evt![1] as { total: number }).total, 1);
		assert.ok(existsSync(ACTIVE));
		const active = JSON.parse(readFileSync(ACTIVE, "utf8")) as Record<string, Record<string, { startedAtMs: number }>>;
		assert.ok(active["s-res"]["1"].startedAtMs > 0);
	});

	it("completion records history and prunes active", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-done");
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 1, subject: "a", status: "in_progress", metadata: { est_minutes: 20 } }]) }, ctx);
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 1, subject: "a", status: "completed", metadata: { est_minutes: 20 } }]) }, ctx);
		const hist = loadHistory(HIST);
		assert.equal(hist.length, 1);
		assert.equal(hist[0].estMin, 20);
		const active = JSON.parse(readFileSync(ACTIVE, "utf8")) as Record<string, unknown>;
		assert.ok(!("s-done" in active));
		handlers["session_shutdown"]({}, ctx);
	});

	it("session_start replays sidecar across sessions", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx1 = makeCtx("s-old");
		handlers["session_start"]({}, ctx1);
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 7, subject: "long task", status: "in_progress" }]) }, ctx1);
		const saved = (JSON.parse(readFileSync(ACTIVE, "utf8")) as Record<string, Record<string, { startedAtMs: number }>>)["s-old"]["7"].startedAtMs;
		const entries = [customEntry([{ id: 7, subject: "long task", status: "in_progress" }])];
		const ctx2 = makeCtx("s-new", entries);
		handlers["session_start"]({}, ctx2);
		const line = ctx2.widgets[ctx2.widgets.length - 1][1]!;
		assert.match(line.join(" "), /long task/);
		assert.ok(saved <= Date.now());
		handlers["session_shutdown"]({}, ctx2);
	});

	it("replay: custom entries beat newer toolResults", () => {
		const { pi, handlers, emitted } = makePi();
		piEta(pi as never);
		const entries = [
			customEntry([{ id: 1, subject: "old truth", status: "pending" }]),
			toolMsg([{ id: 1, subject: "stale echo", status: "pending" }, { id: 2, subject: "ghost", status: "pending" }]),
		];
		const ctx = makeCtx("s-prec", entries);
		handlers["session_start"]({}, ctx);
		const payload = (emitted.find(([ch]) => ch === "pi-eta:eta")![1] as { total: number });
		assert.equal(payload.total, 1);
		handlers["session_shutdown"]({}, ctx);
	});

	it("replay: toolResult fallback when no custom entries", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const entries = [toolMsg([{ id: 9, subject: "fallback task", status: "pending" }])];
		const ctx = makeCtx("s-fb", entries);
		handlers["session_start"]({}, ctx);
		const line = ctx.widgets[ctx.widgets.length - 1][1]!;
		assert.match(line.join(" "), /~10m/);
		handlers["session_shutdown"]({}, ctx);
	});

	it("clear action -> no-plan widget", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-clear");
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: { action: "clear", params: {}, tasks: [], nextId: 5 } }, ctx);
		const line = ctx.widgets[ctx.widgets.length - 1][1]!;
		assert.match(line[0], /no plan/);
		handlers["session_shutdown"]({}, ctx);
	});

	it("session_tree re-replays new branch", () => {
		const { pi, handlers, emitted } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-tree", [customEntry([{ id: 3, subject: "branched", status: "pending" }])]);
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 1, subject: "abandoned", status: "pending" }]) }, ctx);
		handlers["session_tree"]({}, ctx);
		const payloads = emitted.filter(([ch]) => ch === "pi-eta:eta").map(([, p]) => p as { total: number });
		assert.equal(payloads[payloads.length - 1].total, 1);
		assert.match(ctx.widgets[ctx.widgets.length - 1][1]![0], /~10m/);
		handlers["session_shutdown"]({}, ctx);
	});

	it("shutdown clears UI but retains sidecar", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-end");
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 4, subject: "unfinished", status: "in_progress" }]) }, ctx);
		handlers["session_shutdown"]({}, ctx);
		const lastWidget = ctx.widgets[ctx.widgets.length - 1];
		const lastStatus = ctx.statuses[ctx.statuses.length - 1];
		assert.equal(lastWidget[1], undefined);
		assert.equal(lastStatus[1], undefined);
		const active = JSON.parse(readFileSync(ACTIVE, "utf8")) as Record<string, unknown>;
		assert.ok("s-end" in active);
	});

	it("turn_end catches nested codemode mutations", () => {
		const { pi, handlers } = makePi();
		piEta(pi as never);
		const entries = [customEntry([{ id: 5, subject: "nested", status: "completed", metadata: { est_minutes: 8 } }])];
		const ctx = makeCtx("s-nested", entries);
		handlers["tool_result"]({ toolName: "todo", isError: false,
			details: todoDetails([{ id: 5, subject: "nested", status: "in_progress", metadata: { est_minutes: 8 } }]) }, ctx);
		handlers["turn_end"]({}, ctx);
		const hist = loadHistory(HIST);
		assert.equal(hist.length, 1);
		assert.equal(hist[0].estMin, 8);
		handlers["session_shutdown"]({}, ctx);
	});

	it("/eta notifies summary", async () => {
		const { pi, commands } = makePi();
		piEta(pi as never);
		const ctx = makeCtx("s-cmd");
		await commands["eta"].handler("", ctx);
		assert.ok(ctx.notified.length === 1);
		assert.match(ctx.notified[0], /velocity/);
	});
});
