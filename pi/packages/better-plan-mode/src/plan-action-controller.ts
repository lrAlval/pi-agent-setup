import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveImplementationRuntime, snapshotAvailableImplementationModels } from "./implementation-models.ts";
import { planArtifactPath } from "./plan-artifact.ts";
import type { PlanExportDestination } from "./plan-export.ts";
import {
  configuredAutoImplement,
  configuredImplementationModel,
  configuredImplementationPresets,
  configuredImplementationThinkingLevel,
  type PlanModeFixedThinkingLevel,
  type PlanModeSettings,
} from "./settings.ts";
import type { ImplementationRuntimeSelection, PlanModeState } from "./state.ts";

type InteractiveUi = typeof import("./interactive-ui.ts");

interface MenuLifecycle {
  signal: AbortSignal;
  isCurrent(): boolean;
}

export type FreshImplementationTiming = "immediate" | "after-settled";

interface PlanActionControllerOptions {
  loadInteractiveUi(): Promise<InteractiveUi>;
  getState(): PlanModeState;
  captureLifecycle(): MenuLifecycle;
  statusText(): string;
  getThinkingLevel(): PlanModeFixedThinkingLevel | undefined;
  getSettings(): PlanModeSettings;
  implementationOutcome(): string;
  getExportDestination(ctx: ExtensionContext): PlanExportDestination;
  show(ctx: ExtensionContext): void;
  finalize(ctx: ExtensionContext): void;
  implementHere(ctx: ExtensionContext): void | Promise<void>;
  implementFresh(
    ctx: ExtensionContext,
    isCurrent: () => boolean,
    runtime: ImplementationRuntimeSelection | undefined,
    timing: FreshImplementationTiming,
  ): void | Promise<void>;
  exportPlan(ctx: ExtensionContext, path: string, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean>;
  settings(ctx: ExtensionContext, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean>;
  save(ctx: ExtensionContext): void;
  stay(ctx: ExtensionContext): void;
  exitReady(ctx: ExtensionContext): void;
  clearSaved(ctx: ExtensionContext): void;
}

export function createPlanActionController(options: PlanActionControllerOptions) {
  const configuredDefaults = (): ImplementationRuntimeSelection => {
    const settings = options.getSettings();
    const model = configuredImplementationModel(settings);
    const thinkingLevel = configuredImplementationThinkingLevel(settings);
    return {
      ...(model ? { model: { ...model } } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  };
  const effectiveDefaults = (ctx: ExtensionContext): ImplementationRuntimeSelection => {
    const settings = options.getSettings();
    const resolution = resolveImplementationRuntime({
      models: snapshotAvailableImplementationModels(ctx),
      configured: configuredImplementationModel(settings),
      configuredThinkingLevel: configuredImplementationThinkingLevel(settings),
      presets: configuredImplementationPresets(settings),
      planningModel: ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined,
      planningThinkingLevel: options.getThinkingLevel(),
    });
    for (const warning of resolution.warnings) ctx.ui.notify(warning, "warning");
    return {
      ...(resolution.runtime.model ? { model: { ...resolution.runtime.model } } : {}),
      ...(resolution.runtime.thinkingLevel
        ? { thinkingLevel: resolution.runtime.thinkingLevel as PlanModeFixedThinkingLevel }
        : {}),
    };
  };
  const freshAction = (
    ctx: ExtensionContext,
    lifecycle: MenuLifecycle,
    signal: AbortSignal,
    runtime: ImplementationRuntimeSelection | undefined,
    timing: FreshImplementationTiming,
  ) => {
    if (signal.aborted) return;
    const isCurrent = timing === "after-settled" ? lifecycle.isCurrent : () => lifecycle.isCurrent() && !signal.aborted;
    return options.implementFresh(ctx, isCurrent, runtime, timing);
  };

  const refine = (ctx: ExtensionContext) => {
    const path = planArtifactPath(ctx.sessionManager.getSessionId());
    ctx.ui.notify(
      `Plan kept and saved to ${path}. Send feedback to refine it, or reopen /plan when you are ready to implement.`,
      "info",
    );
  };

  return {
    async showSaved(ctx: ExtensionContext) {
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showSavedPlanMenu(ctx, {
        statusText: options.statusText(),
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        signal: lifecycle.signal,
        isCurrent: lifecycle.isCurrent,
        show: () => options.show(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (signal) => freshAction(ctx, lifecycle, signal, effectiveDefaults(ctx), "immediate"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        settings: (signal) => options.settings(ctx, signal, lifecycle.isCurrent),
        clear: () => options.clearSaved(ctx),
      });
    },
    async showCurrent(ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify(options.statusText(), "info");
        return;
      }
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showPlanModeMenu(ctx, {
        statusText: options.statusText(),
        planThinkingLevel: options.getThinkingLevel(),
        implementationDefaults: configuredDefaults(),
        implementationPresets: configuredImplementationPresets(options.getSettings()),
        hasReadyPlan: options.getState().latestPlan !== undefined,
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        ...lifecycle,
        show: () => options.show(ctx),
        finalize: () => options.finalize(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (runtime, signal) => freshAction(ctx, lifecycle, signal, runtime, "immediate"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        save: () => options.save(ctx),
        stay: () => options.stay(ctx),
        exit: () => options.exitReady(ctx),
      });
    },
    async showReady(ctx: ExtensionContext) {
      const settings = options.getSettings();
      // autoImplement 'fresh' means "offer to implement", never "implement without asking":
      // the ready menu is the approval surface and the fresh entry is promoted to the top.
      const autoFresh = configuredAutoImplement(settings) === "fresh" && options.getState().latestPlan !== undefined;
      if (autoFresh && !ctx.hasUI) {
        ctx.ui.notify(options.statusText(), "info");
        return;
      }
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showReadyPlanMenu(ctx, {
        ...lifecycle,
        planThinkingLevel: options.getThinkingLevel(),
        implementationDefaults: configuredDefaults(),
        implementationPresets: configuredImplementationPresets(settings),
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (runtime, signal) => freshAction(ctx, lifecycle, signal, runtime, "after-settled"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        save: () => options.save(ctx),
        stay: () => undefined,
        refine: () => refine(ctx),
        exit: () => options.exitReady(ctx),
        ...(autoFresh ? { freshFirst: true } : {}),
      });
    },
  };
}
