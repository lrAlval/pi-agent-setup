export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  deps: number[];
  blockerReason?: string;
  estimateMin: number;
  budgetMin: number;
  measuredMs: number;
}

export interface TaskState {
  tasks: Task[];
  nextId: number;
  activeId: number | null;
}

export type BatchOp =
  | { op: "create"; ref: string; title: string; estimateMin: number; deps?: Array<number | string>; blockerReason?: string; start?: boolean }
  | { op: "start" | "complete" | "reopen"; ref: number | string }
  | { op: "revise"; ref: number | string; budgetMin: number }
  | { op: "cancel"; ref: number | string; reason?: string };

export interface CompletedObservation {
  taskId: number;
  completedTs: number;
  estimateMs: number;
  actualMs: number;
}

export interface TaskDetails {
  v: 1;
  action: "list" | "apply";
  state: TaskState;
  changedIds: number[];
  nextReadyId: number | null;
  completedObs?: CompletedObservation[];
  error?: string;
}

export class BatchError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join("; "));
    this.name = "BatchError";
    this.reasons = reasons;
  }
}

const validMinutes = (n: number): boolean => Number.isFinite(n) && n > 0;
const cloneState = (s: TaskState): TaskState => ({
  tasks: s.tasks.map((t) => ({ ...t, deps: [...t.deps] })),
  nextId: s.nextId,
  activeId: s.activeId,
});

function resolveRef(ref: number | string, state: TaskState, refs: Map<string, number>): number | undefined {
  if (typeof ref === "number") return ref;
  return refs.get(ref) ?? (/^\d+$/.test(ref) ? Number(ref) : undefined);
}

function taskFor(state: TaskState, id: number): Task | undefined {
  return state.tasks.find((task) => task.id === id);
}

function isReady(task: Task, state: TaskState): boolean {
  return task.status === "pending" && !task.blockerReason && task.deps.every((id) => taskFor(state, id)?.status === "completed");
}

function assertAcyclic(state: TaskState): void {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (id: number): void => {
    if (visiting.has(id)) throw new Error(`dependency cycle includes task ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const task = taskFor(state, id);
    for (const dep of task?.deps ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  state.tasks.forEach((task) => visit(task.id));
}

export function initialTaskState(): TaskState {
  return { tasks: [], nextId: 1, activeId: null };
}

export function applyBatch(
  current: TaskState,
  ops: BatchOp[],
  calibrate: (estimateMin: number) => number = (estimateMin) => estimateMin,
  nowMs = Date.now(),
): { state: TaskState; changedIds: number[]; nextReadyId: number | null; completedObs: CompletedObservation[] } {
  const state = cloneState(current);
  const refs = new Map<string, number>();
  const changed = new Set<number>();
  const completedObs: CompletedObservation[] = [];
  const reasons: string[] = [];

  const fail = (message: string): never => { throw new Error(message); };
  try {
    for (const op of ops) {
      if (op.op === "create") {
        if (!op.ref || refs.has(op.ref)) fail(`duplicate or empty ref '${op.ref}'`);
        if (!op.title.trim()) fail("task title must not be empty");
        if (!validMinutes(op.estimateMin)) fail(`estimateMin must be positive for '${op.ref}'`);
        const id = state.nextId++;
        refs.set(op.ref, id);
        const deps = (op.deps ?? []).map((ref) => {
          const depId = resolveRef(ref, state, refs);
          if (depId === undefined || !taskFor(state, depId)) throw new Error(`unknown dependency '${ref}'`);
          if (depId === id) throw new Error("task cannot depend on itself");
          return depId;
        });
        const task: Task = {
          id, title: op.title.trim(), status: "pending", deps: [...new Set(deps)],
          blockerReason: op.blockerReason?.trim() || undefined,
          estimateMin: op.estimateMin, budgetMin: calibrate(op.estimateMin), measuredMs: 0,
        };
        if (!validMinutes(task.budgetMin)) fail(`calibrated budget must be positive for '${op.ref}'`);
        state.tasks.push(task);
        changed.add(id);
        if (op.start) startTask(task);
      } else {
        const id = resolveRef(op.ref, state, refs);
        if (id === undefined) throw new Error(`unknown task '${op.ref}'`);
        const task = taskFor(state, id);
        if (!task) throw new Error(`unknown task '${op.ref}'`);
        if (op.op === "start") startTask(task);
        else if (op.op === "complete") {
          if (task.status !== "in_progress") fail(`task ${id} is not in progress`);
          task.status = "completed";
          state.activeId = null;
          if (task.measuredMs > 0) completedObs.push({ taskId: id, completedTs: nowMs, estimateMs: task.estimateMin * 60_000, actualMs: task.measuredMs });
        } else if (op.op === "revise") {
          if (!validMinutes(op.budgetMin)) fail(`budgetMin must be positive for task ${id}`);
          task.budgetMin = op.budgetMin;
        } else if (op.op === "cancel") {
          if (task.status === "completed" || task.status === "cancelled") fail(`task ${id} cannot be cancelled from ${task.status}`);
          task.status = "cancelled";
          task.blockerReason = op.reason?.trim() || task.blockerReason;
          if (state.activeId === id) state.activeId = null;
        } else if (op.op === "reopen") {
          if (task.status !== "completed" && task.status !== "cancelled") fail(`task ${id} is not reopenable`);
          if (task.deps.some((dep) => taskFor(state, dep)?.status !== "completed")) fail(`task ${id} has an incomplete dependency`);
          if (state.tasks.some((dependent) => dependent.status === "completed" && dependent.deps.includes(id))) fail(`task ${id} has a completed dependent`);
          task.status = "pending";
          if (task.blockerReason?.startsWith("Blocked by cancelled task ")) task.blockerReason = undefined;
        }
        changed.add(id);
      }
    }
    assertAcyclic(state);
    const active = state.tasks.filter((task) => task.status === "in_progress");
    if (active.length > 1) fail("only one task may be in progress");
    state.activeId = active[0]?.id ?? null;
    for (const task of state.tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        const cancelledDep = task.deps.find((dep) => taskFor(state, dep)?.status === "cancelled");
        if (cancelledDep !== undefined) {
          task.blockerReason = `Blocked by cancelled task ${cancelledDep}`;
          changed.add(task.id);
        } else if (task.blockerReason?.startsWith("Blocked by cancelled task ")) {
          task.blockerReason = undefined;
          changed.add(task.id);
        }
      }
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
    throw new BatchError(reasons);
  }
  const nextReadyId = state.tasks.find((task) => isReady(task, state))?.id ?? null;
  return { state, changedIds: [...changed].sort((a, b) => a - b), nextReadyId, completedObs };

  function startTask(task: Task): void {
    if (state.activeId !== null && state.activeId !== task.id) fail(`task ${state.activeId} is already in progress`);
    if (!isReady(task, state)) fail(`task ${task.id} is blocked or not ready`);
    task.status = "in_progress";
    state.activeId = task.id;
  }
}

export function readyTasks(state: TaskState): Task[] {
  return state.tasks.filter((task) => isReady(task, state));
}
