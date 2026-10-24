import type { Task } from "./tasks.ts";

export interface TimingSnapshot {
  v: 1;
  taskId: number | null;
  measuredMs: number;
  runActive: boolean;
  intervalStartMs: number | null;
  status: "empty" | "running" | "paused" | "completed" | "aborted";
  eligible: boolean;
  sessionMs?: number;
  completedObs?: { taskId: number; completedTs: number; estimateMs: number; actualMs: number };
}

export class ActiveClock {
  private task: Task | null = null;
  private measuredMs = 0;
  private sessionMs = 0;
  private runActive = false;
  private intervalStartMs: number | null = null;
  private sessionIntervalStartMs: number | null = null;
  private status: TimingSnapshot["status"] = "empty";

  constructor(private readonly now: () => number = Date.now) {}

  syncTask(task: Task | null): void {
    this.checkpoint();
    if (this.task?.id !== task?.id) {
      this.task = task;
      this.measuredMs = task?.measuredMs ?? 0;
      this.status = task ? (this.runActive ? "running" : "paused") : "empty";
      this.intervalStartMs = this.task && this.runActive ? this.now() : null;
    }
  }

  agentStart(): TimingSnapshot {
    this.checkpoint();
    this.runActive = true;
    if (this.task) {
      this.status = "running";
      this.intervalStartMs = this.now();
    }
    this.sessionIntervalStartMs = this.now();
    return this.snapshot();
  }

  turnStart(): TimingSnapshot {
    if (this.runActive) return this.snapshot();
    return this.agentStart();
  }

  agentEnd(): TimingSnapshot { return this.pause("paused"); }
  turnEnd(): TimingSnapshot { return this.pause("paused"); }
  sessionShutdown(): TimingSnapshot { return this.pause("aborted", false); }
  sessionBeforeFork(): TimingSnapshot { return this.pause("aborted", false); }

  complete(task: Task, completedTs = this.now()): TimingSnapshot {
    this.checkpoint();
    const actualMs = this.measuredMs;
    task.measuredMs = actualMs;
    const completedObs = actualMs > 0 ? {
      taskId: task.id, completedTs,
      estimateMs: task.estimateMin * 60_000, actualMs,
    } : undefined;
    this.task = null;
    this.runActive = false;
    this.intervalStartMs = null;
    this.status = "completed";
    return { ...this.snapshot(), completedObs };
  }

  snapshot(): TimingSnapshot {
    this.checkpoint();
    return {
      v: 1, taskId: this.task?.id ?? null, measuredMs: this.measuredMs,
      runActive: this.runActive, intervalStartMs: this.intervalStartMs,
      status: this.status, eligible: this.status === "completed" && this.measuredMs > 0,
      sessionMs: this.sessionMs,
    };
  }

  restore(snapshot: TimingSnapshot, task: Task | null = null): void {
    this.task = task;
    this.measuredMs = snapshot.measuredMs;
    this.sessionMs = snapshot.sessionMs ?? 0;
    if (this.task) this.task.measuredMs = snapshot.measuredMs;
    this.runActive = false;
    this.intervalStartMs = null;
    this.sessionIntervalStartMs = null;
    this.status = snapshot.status === "running" ? "aborted" : snapshot.status;
  }

  private pause(status: "paused" | "aborted", preserveTask = true): TimingSnapshot {
    this.checkpoint();
    this.runActive = false;
    this.intervalStartMs = null;
    this.sessionIntervalStartMs = null;
    if (this.task) this.status = status;
    if (!preserveTask) this.task = null;
    return this.snapshot();
  }

  private checkpoint(): void {
    const now = this.now();
    if (this.sessionIntervalStartMs !== null) {
      this.sessionMs += Math.max(0, now - this.sessionIntervalStartMs);
      this.sessionIntervalStartMs = now;
    }
    if (!this.task || !this.runActive || this.intervalStartMs === null) return;
    const elapsed = Math.max(0, now - this.intervalStartMs);
    this.measuredMs += elapsed;
    this.intervalStartMs = now;
    this.task.measuredMs = this.measuredMs;
  }
}
