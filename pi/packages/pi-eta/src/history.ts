/** JSON calibration store. Zero deps (better-sqlite3 is not host-provided). */
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { median } from "./eta.ts";

export interface HistoryRecord {
	estMin: number;
	actualMin: number;
	at: number;
}

export const DEFAULT_HISTORY_PATH = join(homedir(), ".pi", "agent", "pi-eta-history.json");
export const FALLBACK_EST_MIN = 10;
const MIN_SAMPLES = 3;
const MAX_RECORDS = 1000;

export function resolveHistoryPath(): string {
	return process.env.PI_ETA_HISTORY ?? DEFAULT_HISTORY_PATH;
}

function valid(r: unknown): r is HistoryRecord {
	if (typeof r !== "object" || r === null) return false;
	const o = r as Record<string, unknown>;
	return (
		typeof o.estMin === "number" && o.estMin > 0 &&
		typeof o.actualMin === "number" && o.actualMin >= 0 &&
		typeof o.at === "number"
	);
}

export function loadHistory(path: string = resolveHistoryPath()): HistoryRecord[] {
	try {
		if (!existsSync(path)) return [];
		const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!Array.isArray(raw)) return [];
		return raw.filter(valid);
	} catch {
		return [];
	}
}

export function recordHistory(rec: HistoryRecord, path: string = resolveHistoryPath()): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const all = [...loadHistory(path), rec].slice(-MAX_RECORDS);
		writeFileSync(path, JSON.stringify(all), "utf8");
	} catch (e) {
		console.warn("[pi-eta] history write failed: " + String(e));
	}
}

/** Median actual/est ratio. 1.0 until enough samples. Clamped to [0.25, 4]. */
export function velocityRatio(recs: HistoryRecord[]): number {
	if (recs.length < MIN_SAMPLES) return 1;
	const ratios = recs.filter((r) => r.estMin > 0).map((r) => r.actualMin / r.estMin);
	if (ratios.length === 0) return 1;
	return Math.min(4, Math.max(0.25, median(ratios)));
}

/** Median actual duration, else fallback. Used when agent gives no estimate. */
export function defaultEst(recs: HistoryRecord[]): number {
	if (recs.length === 0) return FALLBACK_EST_MIN;
	return Math.max(1, Math.round(median(recs.map((r) => r.actualMin))));
}

/** In-flight task starts. Sidecar so reload/resume keeps elapsed time honest. */
export interface ActiveTask {
	startedAtMs: number;
	estMin: number;
}
export type ActiveMap = Record<string, Record<string, ActiveTask>>;

export const DEFAULT_ACTIVE_PATH = join(homedir(), ".pi", "agent", "pi-eta-active.json");
const ACTIVE_TTL_MS = 7 * 24 * 3600 * 1000;

export function resolveActivePath(): string {
	return process.env.PI_ETA_ACTIVE ?? DEFAULT_ACTIVE_PATH;
}

function validActive(t: unknown): t is ActiveTask {
	if (typeof t !== "object" || t === null) return false;
	const o = t as Record<string, unknown>;
	return typeof o.startedAtMs === "number" && typeof o.estMin === "number" && o.estMin > 0;
}

export function loadActive(path: string = resolveActivePath()): ActiveMap {
	try {
		if (!existsSync(path)) return {};
		const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
		const now = Date.now();
		const out: ActiveMap = {};
		for (const [sess, rec] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof rec !== "object" || rec === null) continue;
			const sessOut: Record<string, ActiveTask> = {};
			for (const [id, t] of Object.entries(rec as Record<string, unknown>)) {
				if (!validActive(t)) continue;
				if (now - t.startedAtMs > ACTIVE_TTL_MS) continue;
				sessOut[id] = t;
			}
			if (Object.keys(sessOut).length > 0) out[sess] = sessOut;
		}
		return out;
	} catch {
		return {};
	}
}

export function saveActive(map: ActiveMap, path: string = resolveActivePath()): void {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(map), "utf8");
	} catch (e) {
		console.warn("[pi-eta] active write failed: " + String(e));
	}
}
