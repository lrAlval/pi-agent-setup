import type { Task, TaskState } from "./tasks.ts";
import { truncateToWidth as truncateTerminalWidth } from "@earendil-works/pi-tui";

export interface WidgetInput { state: TaskState; collapsed?: boolean; width?: number; sessionMs?: number }

const BAR_FILLED = "█";
const BAR_EMPTY = "░";

export function formatTimer(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${Math.floor(totalSeconds / 60)}:${pad(seconds)}`;
}

export function renderBar(done: number, total: number, width: number): string {
  const cells = Math.max(2, Math.floor(width));
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * cells) : 0;
  const fill = Math.max(0, Math.min(cells, filled));
  return BAR_FILLED.repeat(fill) + BAR_EMPTY.repeat(cells - fill);
}

export function renderWidgetLines(input: WidgetInput): string[] {
  const { state } = input;
  if (state.tasks.length === 0) return [];
  const width = Math.max(1, input.width ?? 80);
  const active = state.tasks.find((task) => task.status === "in_progress");
  const ready = state.tasks.filter((task) => task.status === "pending" && !task.blockerReason && task.deps.every((id) => state.tasks.find((dep) => dep.id === id)?.status === "completed"));
  const blocked = state.tasks.filter((task) => task.status === "pending" && !ready.includes(task));
  const done = state.tasks.filter((task) => task.status === "completed").length;
  const view = (task: Task, icon: string): string => truncateToWidth(`${icon} ${task.title}`, width);

  const header = `${renderBar(done, state.tasks.length, Math.min(16, Math.max(2, width / 2)))} ${formatTimer(input.sessionMs ?? 0)} · ${done}/${state.tasks.length} tasks`;
  if (input.collapsed) return [truncateToWidth(header, width)];
  const result: string[] = [truncateToWidth(header, width)];
  if (active) result.push(view(active, "▶"));
  for (const task of ready.slice(0, Math.max(0, 6 - result.length))) result.push(view(task, "○"));
  for (const task of blocked.slice(0, Math.max(0, 6 - result.length))) result.push(view(task, "↳"));
  return result.slice(0, 6).map((line) => truncateToWidth(line, width));
}

export function truncateToWidth(value: string, width: number): string {
  return truncateTerminalWidth(value, Math.max(1, width), "…");
}
