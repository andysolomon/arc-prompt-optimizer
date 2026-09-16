import type { ExtensionCommandContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Measurement } from "../core/index.js";
import { PromptOptimizeUnsupportedModeError, promptOptimizeModeSupport } from "./modes.js";
import { resolveTargetModel, type TargetModel, type TargetModelContext } from "./models.js";
import { runWithProgress, type ProgressContext, type ProgressOptions } from "./progress.js";
import { PREVIEW_COMPLETION_COUNT, runPreview, type PreviewRunOptions, type PreviewRunResult } from "./run.js";
import { reviewCandidates, type ReviewContext } from "./review.js";
import { resolvePromptSource, type PromptSource, type PromptSourceContext } from "./source.js";

/** Narrow command-context surface the handler reads, so tests need no Pi runtime. */
export type PromptOptimizeCommandContext = Pick<ExtensionCommandContext, "mode" | "hasUI"> &
  PromptSourceContext &
  Omit<TargetModelContext, "ui"> &
  ProgressContext & {
    readonly modelRegistry: TargetModelContext["modelRegistry"] & Partial<Pick<ModelRegistry, "complete" | "getAll">>;
    readonly ui: PromptSourceContext["ui"] & TargetModelContext["ui"] & ProgressContext["ui"] & ReviewContext["ui"];
  };

export interface PromptOptimizeDependencies extends ProgressOptions {
  readonly runPreview?: (options: PreviewRunOptions) => Promise<PreviewRunResult>;
}

export type PromptOptimizeOutcome =
  | { readonly status: "unsupported" }
  | { readonly status: "no_source" }
  | { readonly status: "no_model"; readonly source: PromptSource }
  | { readonly status: "declined"; readonly source: PromptSource; readonly model: TargetModel }
  | { readonly status: "cancelled"; readonly source: PromptSource; readonly model: TargetModel }
  | { readonly status: "failed"; readonly source: PromptSource; readonly model: TargetModel; readonly error: unknown }
  | {
      readonly status: "kept";
      readonly source: PromptSource;
      readonly model: TargetModel;
      readonly result: PreviewRunResult;
    }
  | {
      readonly status: "accepted";
      readonly source: PromptSource;
      readonly model: TargetModel;
      readonly result: PreviewRunResult;
      readonly candidateId: string;
      readonly text: string;
    };

function formatMeasurement(measurement: Measurement, format: (value: number) => string): string {
  return measurement.status === "measured" ? format(measurement.value) : "n/a";
}

export function candidateLabel(result: PreviewRunResult, candidateId: string): string {
  if (candidateId === result.baselineCandidateId) return "baseline (source)";
  const candidate = result.candidates.find((entry) => entry.id === candidateId);
  const label = candidate?.metadata?.label;
  return typeof label === "string" ? label : (candidate?.prompt.pattern ?? candidateId);
}

export function formatRankingSummary(result: PreviewRunResult, model: TargetModel): string {
  const lines = result.ranking.map(
    (ranked) =>
      `${ranked.rank}. ${candidateLabel(result, ranked.candidateId)}: score ${formatMeasurement(ranked.quality.combined, (value) => value.toFixed(2))}, latency ${formatMeasurement(ranked.operational.latencyMs, (value) => `${Math.round(value)}ms`)}`,
  );
  return [`/prompt-optimize ranked ${result.candidates.length} candidates on ${model.reference} (${result.completionsUsed} completions):`, ...lines].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mode guard → source → model → cost confirmation → preview run with progress → review.
 * Never submits or persists anything; the editor changes only after an explicit confirmed replace.
 */
export async function runPromptOptimizeCommand(
  args: string,
  ctx: PromptOptimizeCommandContext,
  deps: PromptOptimizeDependencies = {},
): Promise<PromptOptimizeOutcome> {
  const support = promptOptimizeModeSupport(ctx.mode);
  if (!support.supported) {
    if (ctx.hasUI) {
      ctx.ui.notify(support.reason, "error");
      return Object.freeze({ status: "unsupported" });
    }
    // Print/JSON UI methods are no-ops; throw so the host logs the refusal.
    throw new PromptOptimizeUnsupportedModeError(ctx.mode, support.reason);
  }

  const source = await resolvePromptSource(args, ctx);
  if (source === undefined) return Object.freeze({ status: "no_source" });
  const model = await resolveTargetModel(ctx);
  if (model === undefined) return Object.freeze({ status: "no_model", source });

  const confirmed = await ctx.ui.confirm(
    "Run /prompt-optimize?",
    `This evaluates ${PREVIEW_COMPLETION_COUNT} prompt candidates from the ${source.label} with ${model.reference}: ${PREVIEW_COMPLETION_COUNT} model completions, which may incur cost.`,
  );
  if (!confirmed) {
    ctx.ui.notify("/prompt-optimize cancelled; no model calls were made.", "info");
    return Object.freeze({ status: "declined", source, model });
  }

  const run = deps.runPreview ?? runPreview;
  const progress = await runWithProgress(
    ctx,
    `Evaluating ${PREVIEW_COMPLETION_COUNT} prompt candidates with ${model.reference}...`,
    (signal) =>
      run({
        prompt: source.text,
        model: model.reference,
        signal,
        modelRegistry: ctx.modelRegistry as ModelRegistry,
      }),
    deps.createLoader === undefined ? {} : { createLoader: deps.createLoader },
  );

  switch (progress.status) {
    case "completed": {
      const result = progress.value;
      ctx.ui.notify(formatRankingSummary(result, model), "info");
      const review = await reviewCandidates(ctx, result, source);
      if (review.status === "kept") return Object.freeze({ status: "kept", source, model, result });
      ctx.ui.notify("Editor text replaced; review and submit it yourself.", "info");
      return Object.freeze({ status: "accepted", source, model, result, candidateId: review.candidateId, text: review.text });
    }
    case "cancelled":
      ctx.ui.notify("/prompt-optimize cancelled; the editor was not changed.", "info");
      return Object.freeze({ status: "cancelled", source, model });
    case "failed":
      ctx.ui.notify(`/prompt-optimize failed: ${errorMessage(progress.error)}`, "error");
      return Object.freeze({ status: "failed", source, model, error: progress.error });
  }
}
