import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyBatch, initialTaskState, type BatchOp, type TaskDetails, type TaskState } from "./tasks.ts";
import { ActiveClock, type TimingSnapshot } from "./timing.ts";
import { calibratedBudgetFor, forecast, projectFraction, projectRemaining } from "./eta.ts";
import type { Observation } from "./eta.ts";
import { loadRecentObservations, publishObservation } from "./history.ts";
import { renderWidgetLines, truncateToWidth } from "./widget.ts";

const TIMING_ENTRY = "todo-eta-timing";
const WIDGET_KEY = "todo-eta";

export default function todoEtaExtension(pi: ExtensionAPI): void {
  let state: TaskState = initialTaskState();
  let timing: TimingSnapshot = { v: 1, taskId: null, measuredMs: 0, runActive: false, intervalStartMs: null, status: "empty", eligible: false };
  let collapsed = false;
  let observations: Observation[] = [];
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;
  const clock = new ActiveClock();

  const refreshObservations = async (): Promise<void> => {
    try {
      observations = await loadRecentObservations();
    } catch {
      // keep last known observations on read failure
    }
  };

  const persistTiming = (snapshot: TimingSnapshot): void => {
    timing = snapshot;
    pi.appendEntry(TIMING_ENTRY, snapshot);
  };
  const syncClock = (): void => {
    const active = state.tasks.find((task) => task.status === "in_progress") ?? null;
    clock.syncTask(active);
    const snapshot = clock.snapshot();
    if (active && snapshot.taskId === active.id) active.measuredMs = snapshot.measuredMs;
    persistTiming(snapshot);
  };
  const updateWidget = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;
    const hasOpenTasks = state.tasks.some((task) => task.status === "pending" || task.status === "in_progress");
    if (!hasOpenTasks) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(WIDGET_KEY, () => ({
      render: (width) => renderWidgetLines({ state, collapsed, sessionMs: timing.sessionMs, width }),
      invalidate: () => {},
    }));
  };
  const details = (action: TaskDetails["action"], changedIds: number[] = [], error?: string): TaskDetails => ({
    v: 1, action, state, changedIds,
    nextReadyId: state.tasks.find((task) => task.status === "pending" && !task.blockerReason && task.deps.every((id) => state.tasks.find((dep) => dep.id === id)?.status === "completed"))?.id ?? null,
    ...(error ? { error } : {}),
  });

  pi.registerTool({
    name: "todo_eta",
    label: "Todo ETA",
    description: "List and atomically update guarded tasks with dependencies, estimates, and progress timing.",
    executionMode: "sequential",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("apply")]),
      ops: Type.Optional(Type.Array(Type.Union([
        Type.Object({ op: Type.Literal("create"), ref: Type.String(), title: Type.String(), estimateMin: Type.Number(), deps: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]))), blockerReason: Type.Optional(Type.String()), start: Type.Optional(Type.Boolean()) }),
        Type.Object({ op: Type.Literal("start"), ref: Type.Union([Type.String(), Type.Number()]) }),
        Type.Object({ op: Type.Literal("complete"), ref: Type.Union([Type.String(), Type.Number()]) }),
        Type.Object({ op: Type.Literal("reopen"), ref: Type.Union([Type.String(), Type.Number()]) }),
        Type.Object({ op: Type.Literal("revise"), ref: Type.Union([Type.String(), Type.Number()]), budgetMin: Type.Number() }),
        Type.Object({ op: Type.Literal("cancel"), ref: Type.Union([Type.String(), Type.Number()]), reason: Type.Optional(Type.String()) }),
      ]))),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      if (params.action === "list") {
        syncClock();
        await refreshObservations();
        const output = details("list");
        return { content: [{ type: "text", text: JSON.stringify({ ...output, forecast: forecast(state, observations) }, null, 2) }], details: output };
      }
      try {
        syncClock();
        const history = await loadRecentObservations();
        const ops = (params.ops ?? []) as BatchOp[];
        const applied = applyBatch(state, ops, (estimate) => calibratedBudgetFor(estimate, observations));
        for (const observation of applied.completedObs) await publishObservation(observation);
        state = applied.state;
        await refreshObservations();
        const completedTask = state.tasks.find((task) => task.id === timing.taskId && task.status === "completed");
        if (completedTask) {
          const completed = applied.completedObs.find((obs) => obs.taskId === completedTask.id);
          const snapshot = clock.complete(completedTask, completed?.completedTs);
          persistTiming(completed ? { ...snapshot, completedObs: completed } : snapshot);
        } else syncClock();
        const output = { ...details("apply", applied.changedIds), completedObs: applied.completedObs };
        updateWidget(ctx);
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], details: output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const output = details("apply", [], message);
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], details: output, isError: true };
      }
    },
  });

  const checkpointTiming = (snapshot: TimingSnapshot): void => {
    const active = state.tasks.find((task) => task.id === snapshot.taskId);
    if (active) active.measuredMs = snapshot.measuredMs;
    persistTiming(snapshot);
  };
  pi.on("agent_start", async (_event, ctx) => { checkpointTiming(clock.agentStart()); updateWidget(ctx); });
  pi.on("turn_start", async (_event, ctx) => { checkpointTiming(clock.turnStart()); updateWidget(ctx); });
  pi.on("agent_end", async (_event, ctx) => { checkpointTiming(clock.agentEnd()); updateWidget(ctx); });
  pi.on("turn_end", async (_event, ctx) => { checkpointTiming(clock.turnEnd()); updateWidget(ctx); });
  pi.on("session_shutdown", async (_event, ctx) => {
    if (checkpointTimer) clearInterval(checkpointTimer);
    checkpointTimer = undefined;
    checkpointTiming(clock.sessionShutdown());
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
  });
  pi.on("session_before_fork", async (_event, ctx) => { persistTiming(clock.sessionBeforeFork()); updateWidget(ctx); });
  pi.on("session_start", async (_event, ctx) => {
    if (checkpointTimer) clearInterval(checkpointTimer);
    checkpointTimer = setInterval(() => {
      checkpointTiming(clock.snapshot());
      updateWidget(ctx);
    }, 2_000);
    checkpointTimer.unref?.();
    await refreshObservations();
    const restored = reconstructFromSession(ctx);
    if (restored.state) state = restored.state;
    if (restored.timing) {
      timing = restored.timing.status === "running" ? { ...restored.timing, status: "aborted", runActive: false, intervalStartMs: null, eligible: false } : restored.timing;
      const restoredActive = state.tasks.find((task) => task.id === timing.taskId) ?? null;
      clock.restore(timing, restoredActive);
    } else syncClock();
    updateWidget(ctx);
  });

  pi.registerCommand("todo-eta", {
    description: "Show or collapse task ETA widget",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (command === "collapse") collapsed = true;
      else if (command === "expand") collapsed = false;
      else {
        if (!ctx.hasUI) return;
        const lines = [
          "Todo ETA",
          ...renderWidgetLines({ state, sessionMs: timing.sessionMs, width: 72 }),
          `Remaining: ${forecast(state, observations).totalRemainingMin.toFixed(1)} min`,
          "Press Escape to close",
        ];
        if (ctx.mode !== "tui") {
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }
        await ctx.ui.custom((_tui, _theme, keybindings, done) => ({
          render: (width) => lines.map((line) => truncateToWidth(line, width)),
          handleInput: (data) => { if (keybindings.matches(data, "tui.select.cancel")) done(undefined); },
          invalidate: () => {},
        }), { overlay: true });
        return;
      }
      updateWidget(ctx);
    },
  });
}

export function reconstructFromSession(ctx: unknown): { state?: TaskState; timing?: TimingSnapshot } {
  const entries = (ctx as { sessionManager?: { getBranch?: () => Array<Record<string, unknown>> } }).sessionManager?.getBranch?.() ?? [];
  let state: TaskState | undefined;
  let timing: TimingSnapshot | undefined;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === TIMING_ENTRY && entry.data && typeof entry.data === "object") timing = entry.data as TimingSnapshot;
    const message = entry.type === "message" ? entry.message as { role?: string; toolName?: string; details?: TaskDetails } : undefined;
    if (message?.role === "toolResult" && message.toolName === "todo_eta" && message.details?.v === 1 && message.details.state) state = message.details.state;
  }
  return { state, timing };
}
