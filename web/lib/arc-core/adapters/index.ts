/**
 * Web build of the adapter barrel. The repository's `src/adapters/index.ts` also re-exports the Pi
 * completion adapter, which depends on the full Pi coding agent; the web app only needs the
 * provider-neutral completion contract, so that export is omitted here. Everything under
 * `../core` is copied unchanged (see scripts/sync-arc-core.mjs).
 */
export {
  COMPLETION_CANCELLED_CODE,
  COMPLETION_TIMEOUT_CODE,
  CompletionAdapterError,
  CompletionCancelledError,
  CompletionCancellationError,
  CompletionTimeoutError,
  DEFAULT_COMPLETION_TIMEOUT_MS,
  MAX_COMPLETION_MODEL_CHARACTERS,
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_COMPLETION_PROMPT_CHARACTERS,
  MAX_COMPLETION_TIMEOUT_MS,
  completeWithTimeout,
  normalizeCompletionRequest,
  throwIfCompletionAborted,
  validateCompletionResult,
} from "./completion.js";
export type {
  CompletionAdapterErrorCode,
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  CompletionTimeoutOptions,
} from "./completion.js";
