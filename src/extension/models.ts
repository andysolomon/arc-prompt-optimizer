import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface ModelLike {
  readonly provider: string;
  readonly id: string;
}

export interface TargetModel {
  /** Canonical `provider/id` reference, also used as the picker label. */
  readonly reference: string;
  readonly model: ModelLike;
}

export type TargetModelContext = {
  readonly model: ModelLike | undefined;
  readonly scopedModels: readonly { readonly model: ModelLike }[];
  readonly modelRegistry: { getAvailable(): readonly ModelLike[] };
  readonly ui: Pick<ExtensionCommandContext["ui"], "notify" | "select">;
};

export function modelReference(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Scoped models when scoping is configured, otherwise every available model;
 * de-duplicated by provider/id with the active model first when it is listed.
 * Read-only: the session's active model is never changed.
 */
export function listTargetModels(ctx: Omit<TargetModelContext, "ui">): readonly TargetModel[] {
  const pool = ctx.scopedModels.length > 0 ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
  const seen = new Set<string>();
  const targets: TargetModel[] = [];
  for (const model of pool) {
    const reference = modelReference(model);
    if (seen.has(reference)) continue;
    seen.add(reference);
    targets.push(Object.freeze({ reference, model }));
  }
  if (ctx.model !== undefined) {
    const activeReference = modelReference(ctx.model);
    const activeIndex = targets.findIndex((target) => target.reference === activeReference);
    if (activeIndex > 0) targets.unshift(...targets.splice(activeIndex, 1));
  }
  return Object.freeze(targets);
}

/** Asks for the evaluation model, auto-selecting a lone option. Returns undefined after reporting why. */
export async function resolveTargetModel(ctx: TargetModelContext): Promise<TargetModel | undefined> {
  const targets = listTargetModels(ctx);
  if (targets.length === 0) {
    ctx.ui.notify("/prompt-optimize found no available models. Configure a model in Pi first.", "error");
    return undefined;
  }
  if (targets.length === 1) return targets[0];
  const labels = targets.map((target) => target.reference);
  const choice = await ctx.ui.select("Evaluate candidates with which model?", labels);
  const target = choice === undefined ? undefined : targets[labels.indexOf(choice)];
  if (target === undefined) ctx.ui.notify("/prompt-optimize cancelled.", "info");
  return target;
}
