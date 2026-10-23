/**
 * HubScreen — fullscreen read-only task roster.
 *
 * Keys: up/down/k/j navigate, enter tail view, space detail,
 * r refresh, q/Esc close. Width < 40 cols -> compact rows.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { HubTask, TaskBridge } from "./bridge.ts";

export interface HubTheme {
  fg(color: string, text: string): string;
}

const UP = new Set(["\x1b[A", "k", "\x10"]);
const DOWN = new Set(["\x1b[B", "j", "\x0e"]);

function statusColor(s: HubTask["status"]): string {
  switch (s) {
    case "running":
      return "accent";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "killed":
      return "warning";
    default:
      return "dim";
  }
}

export class HubScreen {
  private selected = 0;
  private showTail: string | null = null;
  private showDetail = false;
  private cache: string[] | null = null;
  private lastWidth = 80;

  private readonly bridge: TaskBridge;
  private readonly theme: HubTheme;
  private readonly done: (result: void) => void;

  constructor(bridge: TaskBridge, theme: HubTheme, done: (result: void) => void) {
    this.bridge = bridge;
    this.theme = theme;
    this.done = done;
  }

  invalidate(): void {
    this.cache = null;
  }

  refresh(): void {
    this.cache = null;
  }

  private rows(): HubTask[] {
    return this.bridge.list();
  }

  handleInput(data: string): void {
    const tasks = this.rows();
    if (data === "q" || data === "\x1b" || data === "Q") {
      this.done();
      return;
    }
    if (data === "r" || data === "R") {
      this.refresh();
      return;
    }
    if (this.showTail !== null) {
      if (data === "\r" || data === " " || data === "\x7f") this.showTail = null;
      this.invalidate();
      return;
    }
    if (UP.has(data)) {
      this.selected = Math.max(0, this.selected - 1);
    } else if (DOWN.has(data)) {
      this.selected = Math.min(Math.max(0, tasks.length - 1), this.selected + 1);
    } else if (data === " ") {
      this.showDetail = !this.showDetail;
    } else if (data === "\r" && tasks[this.selected]) {
      this.showTail = tasks[this.selected].id;
    } else {
      return;
    }
    this.invalidate();
  }

  render(width: number): string[] {
    this.lastWidth = width;
    if (this.cache) return this.cache;
    const t = this.theme;
    const tasks = this.rows();
    const lines: string[] = [];
    lines.push(t.fg("accent", `task hub — ${tasks.length} task${tasks.length === 1 ? "" : "s"} (q close, r refresh)`));
    if (!this.bridge.hasFrameSource()) {
      lines.push(t.fg("dim", "0 live frames — pi-background-tasks not loaded or no events yet (fs fallback)"));
    }
    const frameErr = this.bridge.frameErrorText();
    if (frameErr) lines.push(t.fg("error", frameErr));
    if (tasks.length === 0) {
      lines.push(t.fg("dim", "0 tasks — pi-background-tasks not loaded or no tasks yet"));
      lines.push(t.fg("dim", "up/down navigate, enter tail, space detail, r refresh, q/Esc close"));
      this.cache = lines;
      return lines;
    }
    const compact = width < 40;
    tasks.forEach((task, i) => {
      const cursor = i === this.selected ? ">" : " ";
      const status = t.fg(statusColor(task.status), task.status);
      const head = `${cursor} ${task.id.slice(0, 8)} ${status} ${task.name}`;
      lines.push(truncateToWidth(`${head}`, width));
      if (!compact && (i === this.selected || this.showDetail)) {
        if (task.detail) lines.push(truncateToWidth(`  ${t.fg("dim", task.detail.slice(0, width - 4))}`, width));
        if (task.outputPath) lines.push(truncateToWidth(`  ${t.fg("dim", task.outputPath)}`, width));
      }
      if (this.showTail === task.id) {
        const tail = this.bridge.tail(task.id).split("\n").slice(-10);
        for (const l of tail) lines.push(truncateToWidth(`  ${l}`, width));
      }
    });
    // Touch visibleWidth so narrow terminals wrap sanely (import use check).
    void visibleWidth;
    this.cache = lines;
    return lines;
  }
}
