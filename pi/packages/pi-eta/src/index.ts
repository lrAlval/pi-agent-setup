/**
 * pi-eta - live ETA from the rpiv-todo list.
 *
 * Layers on top of the `todo` tool (rpiv-todo): watches tool_call/tool_result,
 * injects missing estimates, tracks per-task timing, calibrates against history,
 * renders a widget + status line, and publishes `pi-eta:eta` on pi.events.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { computeEta, formatEta, isDone, type EtaTask } from "./eta.ts";
import { defaultEst, loadActive, loadHistory, recordHistory, saveActive, velocityRatio, type ActiveTask } from "./history.ts";
import { estimateOf, parseTodoDetails, type RpivTask } from "./rpiv.ts";
import { buildStatusLine, buildWidgetLines } from "./widget.ts";

const TODO_TOOL = "todo";
const WIDGET_KEY = "pi-eta";
const STATUS_KEY = "pi-eta";
export const ETA_EVENT = "pi-eta:eta";
const TICK_MS = 30_000;

const GUIDELINE =
	"pi-eta tracks time estimates from your todos. For multi-step work (3+ steps) keep a todo list: " +
	"no direct todo tool in your environment? Search for it first (it is callable as tools.todo from a sandbox). " +
	"On create, include your honest time estimate as metadata.est_minutes (number, minutes); correct it via " +
	"update when wrong. Keep tasks fine-grained (each under ~60 min); mark in_progress before starting, " +
	"completed immediately when done.";

interface TrackedTask extends EtaTask {}

let tasks: TrackedTask[] = [];
let sid = "unknown";
let timer: ReturnType<typeof setInterval> | undefined;

function currentSid(ctx: ExtensionContext): string {
	try {
		return ctx.sessionManager.getSessionId() ?? "unknown";
	} catch {
		return "unknown";
	}
}

function attachEst(seen: RpivTask[], prev: TrackedTask[], active: Record<string, ActiveTask>, fallback: number): TrackedTask[] {
	const before = new Map(prev.map((t) => [t.id, t]));
	const now = Date.now();
	return seen.map((t) => {
		const p = before.get(t.id);
		const a = active[String(t.id)];
		const estMin = estimateOf(t) ?? p?.estMin ?? (t.status === "in_progress" ? a?.estMin : undefined) ?? fallback;
		let startedAtMs = p?.startedAtMs;
		if (t.status === "in_progress" && startedAtMs === undefined) startedAtMs = a?.startedAtMs ?? now;
		return { id: t.id, subject: t.subject, status: t.status, estMin, startedAtMs };
	});
}

/** Persist in-progress starts so reload/resume keeps elapsed time. Completed auto-prune. */
function snapshotActive(): void {
	const map = loadActive();
	const sess: Record<string, ActiveTask> = {};
	for (const t of tasks) {
		if (t.status === "in_progress" && t.startedAtMs !== undefined)
			sess[String(t.id)] = { startedAtMs: t.startedAtMs, estMin: t.estMin };
	}
	if (Object.keys(sess).length === 0) delete map[sid];
	else map[sid] = sess;
	saveActive(map);
}

function recordCompletions(prev: TrackedTask[], next: TrackedTask[]): void {
	const now = Date.now();
	const before = new Map(prev.map((t) => [t.id, t]));
	for (const t of next) {
		const p = before.get(t.id);
		if (!p || isDone(p.status) || !isDone(t.status)) continue;
		if (p.startedAtMs === undefined) continue;
		recordHistory({ estMin: p.estMin, actualMin: Math.max(0, (now - p.startedAtMs) / 60000), at: now });
	}
}

export interface EtaPayload {
	remainingMin: number;
	done: number;
	total: number;
	current: string | null;
	velocity: number;
	updatedAt: number;
}

function refresh(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const now = Date.now();
	const velocity = velocityRatio(loadHistory());
	const input = { tasks, nowMs: now, velocity };
	const r = computeEta(tasks, now, velocity);
	const payload: EtaPayload = {
		remainingMin: Math.round(r.remainingMin * 10) / 10,
		done: r.done,
		total: r.total,
		current: r.current ? r.current.subject : null,
		velocity: Math.round(velocity * 100) / 100,
		updatedAt: now,
	};
	try {
		pi.events.emit(ETA_EVENT, payload);
	} catch {
		/* non-fatal: footer consumers optional */
	}
	if (!ctx.hasUI) return;
	try {
		ctx.ui.setWidget(WIDGET_KEY, buildWidgetLines(input));
		ctx.ui.setStatus(STATUS_KEY, buildStatusLine(input));
	} catch {
		/* TUI may be tearing down; ignore */
	}
}

function stopTick(): void {
	if (timer !== undefined) {
		clearInterval(timer);
		timer = undefined;
	}
}

/**
 * Replay latest todo snapshot. Mirrors rpiv-todo state/replay.ts exactly:
 * - `custom` entries (customType rpiv-todo-state) are authoritative when any exist
 * - else last `toolResult` message with toolName todo
 * - last-write-wins within each source
 */
function replay(ctx: ExtensionContext): TrackedTask[] {
	try {
		const sm = ctx.sessionManager as unknown as {
			getBranch?: () => unknown[];
			getEntries?: () => unknown[];
		};
		const entries =
			typeof sm.getBranch === "function"
				? sm.getBranch()
				: typeof sm.getEntries === "function"
					? sm.getEntries()
					: [];
		let fromEntries: RpivTask[] | undefined;
		let fromToolResults: RpivTask[] | undefined;
		for (const e of entries) {
			if (typeof e !== "object" || e === null) continue;
			const r = e as {
				type?: string;
				customType?: string;
				data?: unknown;
				message?: { role?: string; toolName?: string; details?: unknown };
			};
			if (r.type === "custom") {
				if (r.customType === "rpiv-todo-state") {
					const t = parseTodoDetails(r.data);
					if (t) fromEntries = t;
				}
				continue;
			}
			if (r.type !== "message") continue;
			const msg = r.message;
			if (msg?.role !== "toolResult" || msg.toolName !== TODO_TOOL) continue;
			const t = parseTodoDetails(msg.details);
			if (t) fromToolResults = t;
		}
		const active = loadActive()[sid] ?? {};
		return attachEst(fromEntries ?? fromToolResults ?? [], [], active, defaultEst(loadHistory()));
	} catch {
		return [];
	}
}

export default function piEta(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		if (!event.systemPromptOptions.promptGuidelines.includes(GUIDELINE)) {
			event.systemPromptOptions.promptGuidelines.push(GUIDELINE);
		}
	});

	function ensureSession(ctx: ExtensionContext): void {
		const id = currentSid(ctx);
		if (id !== sid) {
			sid = id;
			tasks = replay(ctx);
		}
	}

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== TODO_TOOL) return;
		ensureSession(ctx);
		const input = event.input as Record<string, unknown>;
		if (input.action !== "create" && input.action !== "update") return;
		const meta = (input.metadata ?? {}) as Record<string, unknown>;
		if (typeof meta.est_minutes === "number" && meta.est_minutes > 0) return;
		let est: number | undefined;
		if (input.action === "update" && typeof input.id === "number") {
			est = tasks.find((t) => t.id === input.id)?.estMin;
		}
		est ??= defaultEst(loadHistory());
		input.metadata = { ...meta, est_minutes: Math.round(est * 10) / 10 };
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== TODO_TOOL || event.isError) return;
		ensureSession(ctx);
		const seen = parseTodoDetails(event.details);
		if (!seen) return;
		const prev = tasks;
		const active = loadActive()[sid] ?? {};
		tasks = attachEst(seen, prev, active, defaultEst(loadHistory()));
		recordCompletions(prev, tasks);
		snapshotActive();
		refresh(pi, ctx);
	});

	pi.on("session_start", (_event, ctx) => {
		sid = currentSid(ctx);
		tasks = replay(ctx);
		refresh(pi, ctx);
		stopTick();
		if (ctx.hasUI) {
			timer = setInterval(() => {
				try {
					refresh(pi, ctx);
				} catch {
					/* ignore tick errors */
				}
			}, TICK_MS);
			const t = timer as unknown as { unref?: () => void };
			if (typeof t.unref === "function") t.unref();
		}
	});

	pi.on("session_tree", (_event, ctx) => {
		tasks = replay(ctx);
		snapshotActive();
		refresh(pi, ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		// Catches todo mutations made through another tool (ctx.executeTool, e.g. codemode),
		// which never surface as tool_call/tool_result. Custom entries are still appended,
		// so branch replay sees them; completions record against sidecar starts.
		ensureSession(ctx);
		const prev = tasks;
		tasks = replay(ctx);
		recordCompletions(prev, tasks);
		snapshotActive();
		refresh(pi, ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		tasks = replay(ctx);
		snapshotActive();
		refresh(pi, ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		stopTick();
		if (ctx.hasUI) {
			try {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				ctx.ui.setStatus(STATUS_KEY, undefined);
			} catch {
				/* ignore teardown errors */
			}
		}
	});

	pi.registerCommand("eta", {
		description: "Show live ETA from todos + estimate calibration stats",
		handler: async (_args, ctx) => {
			const now = Date.now();
			const history = loadHistory();
			const velocity = velocityRatio(history);
			const r = computeEta(tasks, now, velocity);
			const lines = [
				"ETA " + formatEta(r.remainingMin) + " · " + r.done + "/" + r.total + " done · velocity " + velocity.toFixed(2) + "x",
				...tasks
					.filter((t) => !isDone(t.status))
					.map((t) => "- [" + t.status + "] " + t.subject + " (est " + t.estMin + "m)"),
				"history samples: " + history.length,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
