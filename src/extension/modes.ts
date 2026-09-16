import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ExtensionMode = ExtensionContext["mode"];

export type PromptOptimizeModeSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string };

/**
 * TUI runs with a cancellable loader; RPC uses the dialog-based path (status/notify progress,
 * no interactive cancel). Print/JSON hosts cannot prompt at all, so they are refused.
 */
export function promptOptimizeModeSupport(mode: ExtensionMode): PromptOptimizeModeSupport {
  switch (mode) {
    case "tui":
    case "rpc":
      return Object.freeze({ supported: true });
    case "json":
    case "print":
      return Object.freeze({
        supported: false,
        reason: `/prompt-optimize requires an interactive TUI or RPC host; ${mode} mode cannot prompt for review. Use the arc-prompt CLI for scripted optimization.`,
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
