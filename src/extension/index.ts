import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPromptOptimizeCommand, type PromptOptimizeCommandContext } from "./command.js";

export { PromptOptimizeUnsupportedModeError, promptOptimizeModeSupport } from "./modes.js";
export type { ExtensionMode, PromptOptimizeModeSupport } from "./modes.js";
export { candidateLabel, formatRankingSummary, runPromptOptimizeCommand } from "./command.js";
export type { PromptOptimizeCommandContext, PromptOptimizeDependencies, PromptOptimizeOutcome } from "./command.js";
export { listTargetModels, modelReference, resolveTargetModel } from "./models.js";
export type { ModelLike, TargetModel, TargetModelContext } from "./models.js";
export { PROGRESS_STATUS_KEY, runWithProgress } from "./progress.js";
export type { ProgressContext, ProgressLoader, ProgressLoaderFactory, ProgressOptions, ProgressResult } from "./progress.js";
export {
  PREVIEW_COMPLETION_COUNT,
  PREVIEW_COMPLETION_TIMEOUT_MS,
  PREVIEW_SUITE,
  baselineCandidate,
  buildPreviewCandidates,
  runPreview,
} from "./run.js";
export type { PreviewRunOptions, PreviewRunResult } from "./run.js";
export {
  MAX_EXTENSION_PROMPT_CHARACTERS,
  collectPromptSources,
  latestUserMessageText,
  promptSizeError,
  resolvePromptSource,
} from "./source.js";
export type { BranchEntryLike, PromptSource, PromptSourceContext } from "./source.js";

export const PROMPT_OPTIMIZE_COMMAND = "prompt-optimize";
export const PROMPT_OPTIMIZE_DESCRIPTION = "Generate, evaluate, and review prompt candidates without submitting them";

export async function handlePromptOptimize(args: string, ctx: PromptOptimizeCommandContext): Promise<void> {
  await runPromptOptimizeCommand(args, ctx);
}

/** Pi extension entrypoint. Registers an explicit command only: no tools, input hooks, or persistence. */
export default function arcPromptOptimizerExtension(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand(PROMPT_OPTIMIZE_COMMAND, {
    description: PROMPT_OPTIMIZE_DESCRIPTION,
    handler: (args, ctx) => handlePromptOptimize(args, ctx),
  });
}
