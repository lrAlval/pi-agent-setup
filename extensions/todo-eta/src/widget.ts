import type { Task, TaskState } from "./tasks.ts";
import { truncateToWidth as truncateTerminalWidth } from "@earendil-works/pi-tui";
import { forecast, projectFraction, projectRemaining } from "./eta.ts";
import type { Observation } from "./eta.ts";

/** Minimal structural theme surface so widget styling stays theme-safe without importing TUI internals. */
export interface WidgetTheme { fg(color: unknown, text: string): string; bold(text: string): string }

export interface WidgetInput { state: TaskState; collapsed?: boolean; paused?: boolean; width?: number; observations?: Observation[]; theme?: WidgetTheme }

const BAR_WIDTH = 10;
const COLLAPSED_BAR_WIDTH = 5;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function renderBarCells(fraction: number, width: number): string {
  const w = Math.max(2, Math.floor(width));
  const filled = clamp01(fraction) * w;
  const full = Math.round(filled);
  return "▰".repeat(full) + "▱".repeat(Math.max(0, w - full));
}

export function renderAggregateBar(fraction: number, width: number, label: string): string {
  return label ? `${renderBarCells(fraction, width)} ${label}` : renderBarCells(fraction, width);
}

export function renderWidgetLines(input: WidgetInput): string[] {
  const { state, observations = [], theme } = input;
  const width = Math.max(1, input.width ?? 80);
  const active = state.tasks.find((task) => task.status === "in_progress");
  const ready = state.tasks.filter((task) => task.status === "pending" && !task.blockerReason && task.deps.every((id) => state.tasks.find((dep) => dep.id === id)?.status === "completed"));
  const blocked = state.tasks.filter((task) => task.status === "pending" && !ready.includes(task));
  const remainingMin = (task: Task): number => Math.ceil(Math.max(0, projectRemaining(task, observations)));
  const view = (task: Task, icon: string): string => truncateToWidth(`${icon} ${task.title} (${remainingMin(task)}m)`, width);
  const style = (text: string, kind: "active" | "muted"): string => {
    if (!theme) return text;
    try { return kind === "active" ? theme.bold(text) : theme.fg("muted", text); } catch { return text; }
  };
  if (input.collapsed) {
    if (state.tasks.length === 0) return [truncateToWidth("Todo ETA · no tasks", width)];
    const forecastData = forecast(state, observations);
    const header = active ? `▶ ${active.title}` : `Todo ETA · ${state.tasks.length} tasks`;
    const bar = renderAggregateBar(projectFraction(state, observations), COLLAPSED_BAR_WIDTH, `${forecastData.totalRemainingMin.toFixed(1)}m`);
    return [truncateToWidth(`${header} · ${bar}`, width)];
  }
  const result: string[] = [];
  if (active) result.push(style(view(active, "▶"), "active"));
  for (const task of ready.slice(0, Math.max(0, 5 - result.length))) result.push(style(view(task, "○"), "muted"));
  for (const task of blocked.slice(0, Math.max(0, 5 - result.length))) result.push(style(view(task, "↳"), "muted"));
  if (!active && state.tasks.length === 0) result.push("Todo ETA · no tasks");
  else {
    const eta = forecast(state, observations);
    if (input.paused && active) result.push("Paused · agent not running");
    else if (active && active.measuredMs / 60_000 > active.budgetMin) result.push("Estimate exceeded");
    else if (eta.needsRevision) result.push("ETA needs revision");
    else if (result.length === 0 && !active && state.tasks.some((task) => task.status === "pending")) result.push(`Todo ETA · ${state.tasks.filter((task) => task.status === "pending").length} pending`);
    const fill = projectFraction(state, observations);
    const openCount = state.tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
    const label = openCount === 0 ? "Done · 0m left" : `${Math.round(fill * 100)}% · ${eta.totalRemainingMin.toFixed(1)}m left`;
    result.push(renderAggregateBar(fill, BAR_WIDTH, label));
  }
  return result.slice(0, 7).map((line) => truncateToWidth(line, width));
}

export function truncateToWidth(value: string, width: number): string {
  return truncateTerminalWidth(value, Math.max(1, width), "…");
}
