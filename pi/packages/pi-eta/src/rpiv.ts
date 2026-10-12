/** Structural parsing of rpiv-todo tool details. No dependency on rpiv-todo. */

export interface RpivTask {
	id: number;
	subject: string;
	status: string;
	metadata?: Record<string, unknown>;
}

/** Extract task list from a todo tool_result details blob. Undefined when shape unknown. */
export function parseTodoDetails(details: unknown): RpivTask[] | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const tasks = (details as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) return undefined;
	const out: RpivTask[] = [];
	for (const t of tasks) {
		if (typeof t !== "object" || t === null) continue;
		const o = t as Record<string, unknown>;
		if (typeof o.id !== "number" || typeof o.subject !== "string" || typeof o.status !== "string")
			continue;
		const task: RpivTask = { id: o.id, subject: o.subject, status: o.status };
		if (typeof o.metadata === "object" && o.metadata !== null)
			task.metadata = o.metadata as Record<string, unknown>;
		out.push(task);
	}
	return out;
}

/** Agent-supplied estimate via metadata.est_minutes. Undefined when absent/invalid. */
export function estimateOf(t: RpivTask): number | undefined {
	const m = t.metadata;
	if (typeof m !== "object" || m === null) return undefined;
	const v = (m as Record<string, unknown>).est_minutes;
	return typeof v === "number" && v > 0 && Number.isFinite(v) ? v : undefined;
}
