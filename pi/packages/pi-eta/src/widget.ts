import { computeEta, formatEta, type EtaTask } from "./eta.ts";

export interface WidgetInput {
	tasks: EtaTask[];
	nowMs: number;
	velocity: number;
}

const BAR_LEN = 10;

function progressBar(done: number, total: number): string {
	if (total === 0) return "░".repeat(BAR_LEN);
	const filled = Math.round((done / total) * BAR_LEN);
	return "▓".repeat(filled) + "░".repeat(BAR_LEN - filled);
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export function buildWidgetLines(input: WidgetInput): string[] {
	const r = computeEta(input.tasks, input.nowMs, input.velocity);
	if (r.total === 0) return ["ETA: no plan yet - ask the agent to create todos"];
	const head = "ETA " + formatEta(r.remainingMin) + " · " + r.done + "/" + r.total + " " + progressBar(r.done, r.total);
	if (!r.current) return [head];
	let state: string;
	if (r.current.overMin >= 1) state = "over by " + Math.floor(r.current.overMin) + "m";
	else state = (r.current.elapsedMin < 1 ? "<1m" : Math.floor(r.current.elapsedMin) + "m") + " elapsed";
	return [head, "now: " + truncate(r.current.subject, 48) + " (" + state + ")"];
}

/** One-line footer status. */
export function buildStatusLine(input: WidgetInput): string {
	const r = computeEta(input.tasks, input.nowMs, input.velocity);
	if (r.total === 0) return "ETA: no plan";
	return "ETA " + formatEta(r.remainingMin) + " · " + r.done + "/" + r.total;
}
