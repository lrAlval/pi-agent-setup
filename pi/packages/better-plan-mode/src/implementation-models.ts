import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH = 512;

export interface ImplementationModelOverride {
  provider: string;
  modelId: string;
}

export interface AvailableImplementationModel {
  provider: string;
  id: string;
  name?: string;
}

export function isPendingImplementationModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH
  );
}

export function snapshotAvailableImplementationModels(ctx: ExtensionContext): AvailableImplementationModel[] {
  const getAvailable = ctx.modelRegistry.getAvailable;
  const availableModels = typeof getAvailable === "function" ? getAvailable.call(ctx.modelRegistry) : [];
  const scopedModels = ctx.scopedModels ?? [];
  if (scopedModels.length === 0) return availableModels;
  return scopedModels.flatMap((entry) => {
    const availableModel = availableModels.find(
      (model) => model.provider === entry.model.provider && model.id === entry.model.id,
    );
    return availableModel ? [availableModel] : [];
  });
}

export function findAvailableImplementationModel(
  models: readonly AvailableImplementationModel[],
  configured: ImplementationModelOverride | undefined,
): AvailableImplementationModel | undefined {
  if (!configured) return undefined;
  return models.find((model) => model.provider === configured.provider && model.id === configured.modelId);
}

export interface ImplementationRuntimePreset extends ImplementationModelOverride {
  thinkingLevel?: string;
}

export interface ImplementationRuntimeResolution {
  model?: ImplementationModelOverride;
  thinkingLevel?: string;
}

export interface ResolveImplementationRuntimeInput {
  models: readonly AvailableImplementationModel[];
  configured?: ImplementationModelOverride;
  configuredThinkingLevel?: string;
  presets?: readonly ImplementationRuntimePreset[];
  planningModel?: ImplementationModelOverride;
  planningThinkingLevel?: string;
}

/**
 * Resolution order: configured default model, then the first available preset, then the planning model.
 * An unavailable step is skipped with a warning so a missing or renamed model never blocks a run.
 */
export function resolveImplementationRuntime(input: ResolveImplementationRuntimeInput): {
  runtime: ImplementationRuntimeResolution;
  warnings: string[];
} {
  const warnings: string[] = [];
  let model: ImplementationModelOverride | undefined;
  let thinkingLevel = input.configuredThinkingLevel;

  if (input.configured) {
    const available = findAvailableImplementationModel(input.models, input.configured);
    if (available) model = { provider: available.provider, modelId: available.id };
    else warnings.push("The configured fresh implementation model is unavailable; falling back.");
  }

  if (!model) {
    for (const preset of input.presets ?? []) {
      const available = findAvailableImplementationModel(input.models, {
        provider: preset.provider,
        modelId: preset.modelId,
      });
      if (!available) continue;
      model = { provider: available.provider, modelId: available.id };
      thinkingLevel = preset.thinkingLevel ?? input.configuredThinkingLevel;
      break;
    }
    if (!model && (input.presets?.length ?? 0) > 0) {
      warnings.push("The configured implementation model presets are unavailable; using the planning model.");
    }
  }

  if (!model) model = input.planningModel;
  if (!thinkingLevel) thinkingLevel = input.planningThinkingLevel;

  return {
    runtime: {
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
    warnings,
  };
}
