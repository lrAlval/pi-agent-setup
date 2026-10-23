import type { Task, TaskState } from "./tasks.ts";

export const CAL = { window: 200, ramp: 10, minRatio: 0.25, maxRatio: 4 } as const;
export interface Observation { id: string; ts: number; estimateMs: number; actualMs: number }
export interface TaskForecast { taskId: number; budgetMin: number; remainingMin: number; exceeded: boolean }
export interface Forecast {
  perTask: TaskForecast[];
  totalRemainingMin: number;
  needsRevision: boolean;
  subtotalOtherMin: number;
}

export function computeCorrection(observations: Observation[]): number {
  const recent = observations.slice(-CAL.window).filter((obs) => obs.estimateMs > 0 && obs.actualMs > 0);
  if (recent.length === 0) return 1;
  const ratios = recent.map((obs) => obs.actualMs / obs.estimateMs).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  const strength = Math.min(1, recent.length / CAL.ramp);
  const ramped = 1 + (median - 1) * strength;
  return Math.min(CAL.maxRatio, Math.max(CAL.minRatio, ramped));
}

export function calibratedBudgetFor(estimateMin: number, observations: Observation[]): number {
  return Math.max(1, estimateMin * computeCorrection(observations));
}

export function forecast(state: TaskState): Forecast {
  const perTask = state.tasks
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .map((task) => {
      const elapsedMin = task.measuredMs / 60_000;
      const remainingMin = Math.max(0, task.budgetMin - elapsedMin);
      return { taskId: task.id, budgetMin: task.budgetMin, remainingMin, exceeded: elapsedMin > task.budgetMin };
    });
  const totalRemainingMin = perTask.reduce((sum, item) => sum + item.remainingMin, 0);
  const active = state.tasks.find((task) => task.status === "in_progress");
  const needsRevision = !!active && active.measuredMs / 60_000 >= active.budgetMin;
  const subtotalOtherMin = perTask.filter((item) => item.taskId !== active?.id).reduce((sum, item) => sum + item.remainingMin, 0);
  return { perTask, totalRemainingMin, needsRevision, subtotalOtherMin };
}

export function remainingForTask(task: Task): number {
  return Math.max(0, task.budgetMin - task.measuredMs / 60_000);
}
