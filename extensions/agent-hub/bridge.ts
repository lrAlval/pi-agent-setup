/**
 * TaskBridge — roster source for the hub.
 *
 * Two sources merged, frame wins on id collision:
 *  1. Last HOST_CHANGED / HOST_RESPONSE frame (defensive parse;
 *     unknown fields preserved in `raw`; shape mismatch -> kind "unknown"
 *     row with a loud error, never swallowed).
 *  2. Filesystem fallback scan of <cwd>/.pi/tasks (and the agent-dir
 *     variant): <runId>/<id>.json snapshots + <id>.output, mtime-sorted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HOST_CHANGED_CHANNEL, HOST_RESPONSE_CHANNEL } from "./constants.ts";

export type HubTaskStatus = "running" | "completed" | "failed" | "killed" | "unknown";

export interface HubTask {
  id: string;
  name: string;
  kind: string;
  status: HubTaskStatus;
  startedAt?: number;
  detail?: string;
  outputPath?: string;
  raw?: unknown;
}

export interface EventBusLike {
  on(channel: string, handler: (data: unknown) => void): () => void;
}

interface FrameTaskView {
  task?: Record<string, unknown>;
  kind?: unknown;
  seen?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const VALID_STATUS = new Set(["running", "completed", "failed", "killed"]);

/** Defensive parse of one task view (frame shape or snapshot shape). */
export function parseTaskView(view: unknown): HubTask {
  const rec = asRecord(view);
  const snap = rec && "task" in rec ? asRecord(rec["task"]) : rec;
  if (!snap) {
    return { id: "(unparseable)", name: "(unparseable frame task)", kind: "unknown", status: "unknown", raw: view };
  }
  const id = str(snap["id"], "(no-id)");
  const statusRaw = str(snap["status"], "");
  const status: HubTaskStatus = VALID_STATUS.has(statusRaw) ? (statusRaw as HubTaskStatus) : "unknown";
  const kind =
    rec && "kind" in rec && typeof rec["kind"] === "string"
      ? (rec["kind"] as string)
      : str(snap["isAgent"], "") === "true"
        ? "agent"
        : "shell";
  return {
    id,
    name: str(snap["name"] ?? snap["command"], id),
    kind,
    status,
    startedAt: num(snap["startTime"] ?? snap["startedAt"]),
    detail: str(snap["command"] ?? snap["description"], ""),
    outputPath: typeof snap["outputPath"] === "string" ? (snap["outputPath"] as string) : undefined,
    raw: view,
  };
}

function frameTasks(frame: unknown): { tasks: HubTask[]; error?: string } {
  const rec = asRecord(frame);
  if (!rec) return { tasks: [], error: `hub: frame is not an object (${typeof frame})` };
  const list = rec["tasks"];
  if (list === undefined) return { tasks: [] }; // revision ping (HostChangedFrame): no rows, no error
  if (!Array.isArray(list)) {
    return {
      tasks: [{ id: "(bad-frame)", name: "unparseable tasks frame", kind: "unknown", status: "unknown", raw: frame }],
      error: "hub: frame.tasks is not an array",
    };
  }
  return { tasks: (list as unknown[]).map(parseTaskView) };
}

/** Snapshot files: <tasksDir>/<runId>/<id>.json, newest run first. */
export function scanTasksDir(tasksDir: string, limit = 50): HubTask[] {
  let runIds: string[] = [];
  try {
    runIds = readdirSync(tasksDir).sort().reverse().slice(0, 20);
  } catch {
    return [];
  }
  const out: HubTask[] = [];
  for (const run of runIds) {
    let files: string[] = [];
    try {
      const st = statSync(join(tasksDir, run));
      if (!st.isDirectory()) continue;
      files = readdirSync(join(tasksDir, run)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    // Newest snapshot first within a run.
    const withMtime = files
      .map((f) => {
        try {
          return { f, m: statSync(join(tasksDir, run, f)).mtimeMs };
        } catch {
          return { f, m: 0 };
        }
      })
      .sort((a, b) => b.m - a.m);
    for (const { f } of withMtime) {
      if (out.length >= limit) break;
      try {
        const snap = JSON.parse(readFileSync(join(tasksDir, run, f), "utf8")) as unknown;
        const task = parseTaskView(snap);
        const rec = asRecord(snap);
        const outPath =
          rec && typeof rec["outputPath"] === "string" ? (rec["outputPath"] as string) : undefined;
        out.push({ ...task, outputPath: outPath ?? join(tasksDir, run, f.replace(/\.json$/, ".output")) });
      } catch {
        out.push({
          id: f.replace(/\.json$/, ""),
          name: `(unreadable snapshot ${f})`,
          kind: "unknown",
          status: "unknown",
        });
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

export class TaskBridge {
  private unsubs: Array<() => void> = [];
  private lastFrame: unknown = null;
  private frameError: string | null = null;
  private readonly tasksDirs: string[];

  private readonly events: EventBusLike;
  private readonly tasksDirs: string[];

  constructor(events: EventBusLike, tasksDirs: string[]) {
    this.events = events;
    this.tasksDirs = tasksDirs;
  }

  subscribe(onChange: () => void): () => void {
    const onFrame = (data: unknown): void => {
      this.lastFrame = data;
      const rec = asRecord(data);
      if (!rec) {
        this.frameError = "hub: frame is not an object";
      } else {
        const parsed = frameTasks(data);
        this.frameError = parsed.error ?? null;
      }
      try {
        onChange();
      } catch {
        // subscriber errors never break the bus
      }
    };
    this.unsubs.push(this.events.on(HOST_CHANGED_CHANNEL, onFrame));
    this.unsubs.push(this.events.on(HOST_RESPONSE_CHANNEL, onFrame));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const u of this.unsubs.splice(0)) {
        try {
          u();
        } catch {
          // unsubscribe is best-effort
        }
      }
    };
  }

  frameErrorText(): string | null {
    return this.frameError;
  }

  hasFrameSource(): boolean {
    return this.lastFrame !== null;
  }

  list(): HubTask[] {
    const byId = new Map<string, HubTask>();
    for (const dir of this.tasksDirs) {
      for (const t of scanTasksDir(dir)) {
        if (!byId.has(t.id)) byId.set(t.id, t);
      }
    }
    if (this.lastFrame !== null) {
      const { tasks } = frameTasks(this.lastFrame);
      for (const t of tasks) {
        const prev = byId.get(t.id);
        // Frame wins on status/kind, but keep the fs outputPath when the frame has none.
        byId.set(t.id, prev && !t.outputPath ? { ...t, outputPath: prev.outputPath } : t);
      }
    }
    return [...byId.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  tail(id: string, maxBytes = 2048): string {
    const found = this.list().find((t) => t.id === id || t.id.startsWith(id));
    if (!found) return `(hub) no task matching "${id}"`;
    const p = found.outputPath;
    if (!p) return `(hub) task ${found.id} has no output path`;
    let buf: Buffer;
    try {
      buf = readFileSync(p) as unknown as Buffer;
    } catch {
      // readFileSync without encoding returns Buffer; typed loosely on purpose
      try {
        const text = readFileSync(p, "utf8");
        buf = Buffer.from(text, "utf8");
      } catch {
        return `(hub) cannot read output for ${found.id}: ${p}`;
      }
    }
    if (buf.length <= maxBytes) return buf.toString("utf8") || "(hub) empty output so far";
    return buf.subarray(buf.length - maxBytes).toString("utf8");
  }
}

export type { FrameTaskView };
