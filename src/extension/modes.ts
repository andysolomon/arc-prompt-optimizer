import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ExtensionMode = ExtensionContext["mode"];

export type PromptOptimizeModeSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string };

/**
 * `/prompt-optimize` needs custom TUI components for progress, cancellation, and
 * review. RPC hosts return `undefined` from `ctx.ui.custom()`, and print/JSON hosts
 * cannot prompt at all, so every non-TUI mode is reported instead of run invisibly.
 */
export function promptOptimizeModeSupport(mode: ExtensionMode): PromptOptimizeModeSupport {
  switch (mode) {
    case "tui":
      return Object.freeze({ supported: true });
    case "rpc":
      return Object.freeze({
        supported: false,
        reason: "/prompt-optimize requires the interactive TUI; RPC mode cannot show its review UI.",
      });
    case "json":
    case "print":
      return Object.freeze({
        supported: false,
        reason: `/prompt-optimize requires the interactive TUI; ${mode} mode cannot prompt for review. Use the arc-prompt CLI for scripted optimization.`,
      });
  }
}

export class PromptOptimizeUnsupportedModeError extends Error {
  readonly mode: ExtensionMode;

  constructor(mode: ExtensionMode, reason: string) {
    super(reason);
    this.name = "PromptOptimizeUnsupportedModeError";
    this.mode = mode;
  }
}
