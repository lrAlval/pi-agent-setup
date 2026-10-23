import type { Task, TaskState } from "./tasks.ts";
import { truncateToWidth as truncateTerminalWidth } from "@earendil-works/pi-tui";
import { forecast } from "./eta.ts";

export interface WidgetInput { state: TaskState; collapsed?: boolean; paused?: boolean; width?: number }

export function renderWidgetLines(input: WidgetInput): string[] {
  const { state } = input;
  const width = Math.max(1, input.width ?? 80);
  const active = state.tasks.find((task) => task.status === "in_progress");
  const ready = state.tasks.filter((task) => task.status === "pending" && !task.blockerReason && task.deps.every((id) => state.tasks.find((dep) => dep.id === id)?.status === "completed"));
  const blocked = state.tasks.filter((task) => task.status === "pending" && !ready.includes(task));
  const view = (task: Task, icon: string): string => truncateToWidth(`${icon} ${task.title} (${Math.ceil(Math.max(0, task.budgetMin - task.measuredMs / 60_000))}m)`, width);
  if (input.collapsed) return [truncateToWidth(active ? `▶ ${active.title}` : `Todo ETA · ${state.tasks.length} tasks`, width)];
  const result: string[] = [];
  if (active) result.push(view(active, "▶"));
  for (const task of ready.slice(0, Math.max(0, 5 - result.length))) result.push(view(task, "○"));
  for (const task of blocked.slice(0, Math.max(0, 5 - result.length))) result.push(view(task, "↳"));
  const eta = forecast(state);
  if (!active && state.tasks.length === 0) result.push("Todo ETA · no tasks");
  else if (input.paused && active) result.push("Paused · agent not running");
  else if (active && active.measuredMs / 60_000 > active.budgetMin) result.push("Estimate exceeded");
  else if (eta.needsRevision) result.push("ETA needs revision");
  return result.slice(0, 6).map((line) => truncateToWidth(line, width));
}

export function truncateToWidth(value: string, width: number): string {
  return truncateTerminalWidth(value, Math.max(1, width), "…");
}
