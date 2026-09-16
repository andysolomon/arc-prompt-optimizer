import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PromptOptimizeUnsupportedModeError, promptOptimizeModeSupport } from "./modes.js";

export { PromptOptimizeUnsupportedModeError, promptOptimizeModeSupport } from "./modes.js";
export type { ExtensionMode, PromptOptimizeModeSupport } from "./modes.js";

export const PROMPT_OPTIMIZE_COMMAND = "prompt-optimize";
export const PROMPT_OPTIMIZE_DESCRIPTION = "Generate, evaluate, and review prompt candidates without submitting them";

/** Narrow command-context surface the handler reads, so tests need no Pi runtime. */
export type PromptOptimizeCommandContext = Pick<ExtensionCommandContext, "mode" | "hasUI"> & {
  readonly ui: Pick<ExtensionCommandContext["ui"], "notify">;
};

export async function handlePromptOptimize(_args: string, ctx: PromptOptimizeCommandContext): Promise<void> {
  const support = promptOptimizeModeSupport(ctx.mode);
  if (!support.supported) {
    if (ctx.hasUI) {
      ctx.ui.notify(support.reason, "error");
      return;
    }
    // Print/JSON UI methods are no-ops; throw so the host logs the refusal.
    throw new PromptOptimizeUnsupportedModeError(ctx.mode, support.reason);
  }
  ctx.ui.notify("/prompt-optimize is installed; source selection and candidate review are not available yet.", "warning");
}

/** Pi extension entrypoint. Registers an explicit command only: no tools, input hooks, or persistence. */
export default function arcPromptOptimizerExtension(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand(PROMPT_OPTIMIZE_COMMAND, {
    description: PROMPT_OPTIMIZE_DESCRIPTION,
    handler: (args, ctx) => handlePromptOptimize(args, ctx),
  });
}
