import { isReasoningProvider, modelLabel, MODELS } from "@/lib/models";
import type { RunErrorKind } from "@/lib/types";

/**
 * Why a run produced nothing, as the page keeps it: the server's error summary for a failed run, or what the
 * page itself ran into. Persisted with the session so a reload, or a phone that comes back hours later, still
 * shows it; a toast alone is gone in seconds and is not shown at all while the app is in the background.
 */
export interface RunFailure {
  readonly kind: RunErrorKind | "unavailable" | "lost" | "rejected" | "abandoned";
  readonly message: string;
  readonly model: string;
  /** Epoch milliseconds when the failure was recorded. */
  readonly at: number;
  readonly runId?: string;
  readonly statusCode?: number;
  readonly lastStep?: string;
}

export function isRunFailure(value: unknown): value is RunFailure {
  const entry = value as Partial<RunFailure> | null;
  return typeof entry === "object" && entry !== null && typeof entry.kind === "string" && typeof entry.message === "string" && typeof entry.model === "string" && typeof entry.at === "number";
}

/** Mirrors the server's per-completion timeouts (`COMPLETION_TIMEOUT_MS`, `SLOW_COMPLETION_TIMEOUT_MS` in `lib/optimize-run.ts`). */
export function completionTimeoutSeconds(model: string): number {
  const provider = MODELS.find((entry) => entry.id === model)?.provider;
  return provider !== undefined && isReasoningProvider(provider) ? 120 : 60;
}

/** How long the server keeps a run's record, in minutes (`RUN_TTL_MS` in `lib/run-store.ts`). */
export const RUN_RETENTION_MINUTES = 30;

/** Short title for the failure panel. */
export function failureTitle(failure: RunFailure): string {
  switch (failure.kind) {
    case "rejected":
      return "The optimization could not start";
    case "abandoned":
      return "A previous optimization was not picked up";
    default:
      return "The optimization did not finish";
  }
}

/** What to do about it, in one or two sentences, for the failure panel. */
export function failureAdvice(failure: RunFailure): string {
  const model = modelLabel(failure.model);
  switch (failure.kind) {
    case "timeout":
      return `${model} did not answer one completion within the ${completionTimeoutSeconds(failure.model)} s limit per completion. Reasoning models such as GLM-5.3 and Kimi K2.6 often need longer on long prompts. Try a faster model, such as Claude Haiku 4.5 or Gemini 2.5 Flash, or shorten the prompt.`;
    case "rate_limit":
      return `${model}'s provider rate-limited the request. Wait a minute and try again, or pick another model.`;
    case "provider":
      return `${model}'s provider rejected the request${failure.statusCode === undefined ? "" : ` (HTTP ${failure.statusCode})`}. Try again, or pick another model.`;
    case "cancelled":
      return "The run was stopped on the server before it finished. Try again.";
    case "unavailable":
      return `The server no longer has this run: it ended more than ${RUN_RETENTION_MINUTES} minutes ago, another tab collected it, or the server instance that held it was replaced. Start it again.`;
    case "lost":
      return "This page could not reach the server, or the run did not report back, within the time it waits. The run itself continues on the server for up to five minutes; if your connection dropped, check it and try again.";
    case "rejected":
      return failure.statusCode === 429 ? "Wait for the limit to reset, then try again." : "Check the prompt and the model, then try again.";
    case "abandoned":
      return `The server keeps a run's result for ${RUN_RETENTION_MINUTES} minutes, and this page came back later than that. Start the optimization again.`;
    case "unknown":
      return "Try again. If it keeps failing, pick another model.";
  }
}
