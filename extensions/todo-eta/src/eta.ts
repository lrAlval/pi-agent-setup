import type { CompletedObservation, Task, TaskState } from "./tasks.ts";

export const CAL = { window: 200, ramp: 3, minRatio: 0.05, maxRatio: 4 } as const;
export interface Observation { id: string; ts: number; estimateMs: number; actualMs: number }
export interface TaskForecast { taskId: number; budgetMin: number; remainingMin: number; exceeded: boolean }
export interface Forecast {
  perTask: TaskForecast[];
  totalRemainingMin: number;
  needsRevision: boolean;
  subtotalOtherMin: number;
}

export function calibration(observations: Observation[]): { ratio: number; strength: number } {
  const recent = observations.slice(-CAL.window).filter((obs) => obs.estimateMs > 0 && obs.actualMs > 0);
  if (recent.length === 0) return { ratio: 1, strength: 0 };
  const ratios = recent.map((obs) => obs.actualMs / obs.estimateMs).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  const strength = Math.min(1, recent.length / CAL.ramp);
  const ramped = 1 + (median - 1) * strength;
  return { ratio: Math.min(CAL.maxRatio, Math.max(CAL.minRatio, ramped)), strength };
}

export function computeCorrection(observations: Observation[]): number {
  return calibration(observations).ratio;
}

export function abortObservationFor(state: TaskState, nowMs = Date.now()): CompletedObservation | undefined {
  const task = state.tasks.find((candidate) => candidate.status === "in_progress");
  if (!task || task.measuredMs <= 0) return undefined;
  return {
    taskId: task.id,
    completedTs: nowMs,
    estimateMs: task.estimateMin * 60_000,
    actualMs: task.measuredMs,
  };
}

export function calibratedBudgetFor(estimateMin: number, observations: Observation[]): number {
  return Math.max(1, estimateMin * computeCorrection(observations));
}

export function projectTotalMin(task: Task, observations: Observation[]): number {
  if (observations.length === 0) return Math.max(0, task.budgetMin);
  return Math.max(0, task.estimateMin * computeCorrection(observations));
}

export function projectRemaining(task: Task, observations: Observation[]): number {
  return Math.max(0, projectTotalMin(task, observations) - task.measuredMs / 60_000);
}

export function projectFraction(state: TaskState, observations: Observation[]): number {
  const open = state.tasks.filter((task) => task.status === "pending" || task.status === "in_progress");
  const budget = open.reduce((sum, task) => sum + projectTotalMin(task, observations), 0);
  if (budget <= 0) return 0;
  const consumed = open.reduce((sum, task) => sum + Math.min(projectTotalMin(task, observations), task.measuredMs / 60_000), 0);
  return Math.min(1, Math.max(0, consumed / budget));
}

export function forecast(state: TaskState, observations: Observation[] = []): Forecast {
  const perTask = state.tasks
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .map((task) => {
      const elapsedMin = task.measuredMs / 60_000;
      const remainingMin = projectRemaining(task, observations);
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
