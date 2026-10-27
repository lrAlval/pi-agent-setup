import type { Task, TaskState } from "./tasks.ts";
import type { Observation } from "./eta.ts";
import { calibration, forecast } from "./eta.ts";
import { truncateToWidth as truncateTerminalWidth } from "@earendil-works/pi-tui";

export interface WidgetInput { state: TaskState; collapsed?: boolean; width?: number; observations?: Observation[] }

const BAR_FILLED = "█";
const BAR_EMPTY = "░";

export function renderBar(done: number, total: number, width: number): string {
  const cells = Math.max(2, Math.floor(width));
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * cells) : 0;
  const fill = Math.max(0, Math.min(cells, filled));
  return BAR_FILLED.repeat(fill) + BAR_EMPTY.repeat(cells - fill);
}

export function bandMinutes(min: number, strength: number): { lo: number; hi: number; weak: boolean } {
  const factor = 1 + (1 - strength);
  const lo = Math.max(0, Math.round(min / factor));
  const hi = Math.round(min * factor);
  return { lo, hi, weak: strength < 1 && lo !== hi };
}

export function formatEta(min: number, strength: number): string {
  if (min <= 0) return "~0m";
  const band = bandMinutes(min, strength);
  return band.weak ? `${band.lo}-${band.hi}m` : `~${Math.round(min)}m`;
}

interface TaskView { task: Task; icon: string; remainingMin: number; budgetMin: number }

function isReady(task: Task, state: TaskState): boolean {
  return task.status === "pending" && !task.blockerReason && task.deps.every((id) => state.tasks.find((dep) => dep.id === id)?.status === "completed");
}

function groupTasks(state: TaskState, observations: Observation[]): { active: TaskView | null; ready: TaskView[]; blocked: TaskView[]; done: TaskView[]; cancelled: TaskView[] } {
  const perTask = new Map(forecast(state, observations).perTask.map((item) => [item.taskId, item]));
  const viewFor = (task: Task): TaskView => {
    const item = perTask.get(task.id);
    return { task, icon: "▶", remainingMin: item?.remainingMin ?? 0, budgetMin: item?.budgetMin ?? task.budgetMin };
  };
  const groups: ReturnType<typeof groupTasks> = { active: null, ready: [], blocked: [], done: [], cancelled: [] };
  for (const task of state.tasks) {
    if (task.status === "completed") { groups.done.push({ ...viewFor(task), icon: "✓" }); continue; }
    if (task.status === "cancelled") { groups.cancelled.push({ ...viewFor(task), icon: "✗" }); continue; }
    if (task.status === "in_progress") { groups.active = viewFor(task); continue; }
    if (isReady(task, state)) groups.ready.push({ ...viewFor(task), icon: "○" });
    else groups.blocked.push({ ...viewFor(task), icon: "↳" });
  }
  return groups;
}

function headerLine(state: TaskState, remainingMin: number, strength: number, width: number): string {
  const done = state.tasks.filter((task) => task.status === "completed").length;
  const cancelled = state.tasks.filter((task) => task.status === "cancelled").length;
  const total = state.tasks.length - cancelled;
  const suffix = cancelled > 0 ? ` (+${cancelled} cancelled)` : "";
  const active = state.tasks.find((task) => task.status === "in_progress");
  const activeProgress = active && Number.isFinite(active.estimateMin) && active.estimateMin > 0
    ? Math.min(1, Math.max(0, active.measuredMs / (active.estimateMin * 60_000)))
    : 0;
  const bar = renderBar(done + activeProgress, Math.max(1, total), Math.min(16, Math.max(2, width / 2)));
  return `${bar} Todos ${done}/${total} done · ${formatEta(remainingMin, strength)}${suffix}`;
}

function taskLine(view: TaskView, isActive: boolean, strength: number): string {
  const { task } = view;
  const elapsedMin = Math.floor(task.measuredMs / 60_000);
  const parts = [`${view.icon} #${task.id} ${task.title}`, formatEta(view.remainingMin, strength)];
  if (isActive) {
    parts.push(`${elapsedMin}/${Math.round(view.budgetMin)}m`);
  } else if (elapsedMin > 0) {
    parts.push(`${elapsedMin}m elapsed`);
  }
  return parts.join(" · ");
}

export function renderWidgetLines(input: WidgetInput): string[] {
  const { state } = input;
  if (state.tasks.length === 0) return [];
  const width = Math.max(1, input.width ?? 80);
  const observations = input.observations ?? [];
  const { strength } = calibration(observations);
  const { totalRemainingMin } = forecast(state, observations);
  const header = headerLine(state, totalRemainingMin, strength, width);
  if (input.collapsed) return [truncateToWidth(header, width)];
  const groups = groupTasks(state, observations);
  const rows: string[] = [];
  if (groups.active) rows.push(taskLine(groups.active, true, strength));
  for (const view of groups.ready) rows.push(taskLine(view, false, strength));
  for (const view of groups.blocked) rows.push(taskLine(view, false, strength));
  const result: string[] = [truncateToWidth(header, width)];
  result.push(...rows.slice(0, 5).map((line) => truncateToWidth(line, width)));
  return result.slice(0, 6).map((line) => truncateToWidth(line, width));
}

export function renderOverlayLines(input: WidgetInput): string[] {
  const width = Math.max(1, input.width ?? 72);
  const observations = input.observations ?? [];
  const { strength } = calibration(observations);
  const { totalRemainingMin } = forecast(input.state, observations);
  const lines: string[] = ["Todo ETA", truncateToWidth(headerLine(input.state, totalRemainingMin, strength, width), width), ""];
  const groups = groupTasks(input.state, observations);
  for (const view of groups.active ? [groups.active] : []) lines.push(truncateToWidth(taskLine(view, true, strength), width));
  for (const view of groups.ready) lines.push(truncateToWidth(taskLine(view, false, strength), width));
  for (const view of groups.blocked) {
    const reason = view.task.blockerReason ? ` · blocked: ${view.task.blockerReason}` : "";
    lines.push(truncateToWidth(`${taskLine(view, false, strength)}${reason}`, width));
  }
  if (groups.done.length > 0) lines.push("");
  for (const view of groups.done) lines.push(truncateToWidth(`${view.icon} #${view.task.id} ${view.task.title}`, width));
  if (groups.cancelled.length > 0) lines.push("");
  for (const view of groups.cancelled) lines.push(truncateToWidth(`${view.icon} #${view.task.id} ${view.task.title}`, width));
  lines.push("");
  lines.push(truncateToWidth(`Remaining: ${formatEta(totalRemainingMin, strength)}`, width));
  return lines;
}

export function truncateToWidth(value: string, width: number): string {
  return truncateTerminalWidth(value, Math.max(1, width), "…");
}
