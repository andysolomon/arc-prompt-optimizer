import "server-only";
import type { ModelId, OptimizeResult, RefineSettings, StepEvent } from "@/lib/types";

/**
 * Structured run logging. Every event is one JSON line on stdout (or stderr for failures), so Vercel's runtime
 * logs and log drains can filter on `event` (for example `arc.run.failed`) and group on `runId`. Prompts, outputs,
 * and rewrite notes are never included; only ids, statuses, counts, durations, and error summaries.
 */
export type RunTransport = "job" | "stream" | "json";

export interface RunMeta {
  readonly runId: string;
  readonly transport: RunTransport;
  readonly model: ModelId;
  readonly judge: boolean;
  readonly rewrite: boolean;
  readonly refine?: RefineSettings;
  /** Images attached to every completion. */
  readonly attachments: number;
}

export type RunErrorKind = "timeout" | "cancelled" | "rate_limit" | "provider" | "unknown";

/** What went wrong, without any request content: the error class, a bounded message, and the provider status. */
export interface RunErrorInfo {
  readonly kind: RunErrorKind;
  readonly name: string;
  readonly message: string;
  readonly statusCode?: number;
}

export const MAX_ERROR_MESSAGE_CHARACTERS = 500;

/** Walks `cause` links so a wrapped error ("The baseline candidate failed: …") still classifies by its root. */
function* causes(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  for (let current = error; current !== undefined && current !== null && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    yield current;
  }
}

export function describeError(error: unknown): RunErrorInfo {
  const name = error instanceof Error ? error.name : typeof error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.length > MAX_ERROR_MESSAGE_CHARACTERS ? `${raw.slice(0, MAX_ERROR_MESSAGE_CHARACTERS)}…` : raw;
  let statusCode: number | undefined;
  let kind: RunErrorKind | undefined;
  for (const cause of causes(error)) {
    const causeName = cause instanceof Error ? cause.name : "";
    const causeMessage = cause instanceof Error ? cause.message : "";
    const code = (cause as { code?: unknown })?.code;
    const status = (cause as { statusCode?: unknown })?.statusCode;
    if (statusCode === undefined && typeof status === "number") statusCode = status;
    if (kind !== undefined) continue;
    if (code === "TIMEOUT" || causeName === "CompletionTimeoutError" || /timed out/iu.test(causeMessage)) kind = "timeout";
    else if (code === "CANCELLED" || causeName === "AbortError" || causeName === "CompletionCancelledError") kind = "cancelled";
    else if (typeof status === "number") kind = status === 429 ? "rate_limit" : "provider";
    else if (causeName === "APICallError" || causeName === "RetryError") kind = "provider";
  }
  return { kind: kind ?? "unknown", name, message, ...(statusCode === undefined ? {} : { statusCode }) };
}

export type RunLogLevel = "info" | "error";
export type RunLogSink = (level: RunLogLevel, line: Record<string, unknown>) => void;

const consoleSink: RunLogSink = (level, line) => {
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else console.log(text);
};

export type RunStopReason = "client_disconnected" | "cancel_requested";

/** Emits the lifecycle of one run: started, each step with its elapsed time, then completed, failed, or cancelled. */
export class RunObserver {
  readonly #meta: RunMeta;
  readonly #sink: RunLogSink;
  readonly #now: () => number;
  readonly #started: number;
  #lastStep: string | undefined;
  #ended = false;

  constructor(meta: RunMeta, sink: RunLogSink = consoleSink, now: () => number = () => performance.now()) {
    this.#meta = meta;
    this.#sink = sink;
    this.#now = now;
    this.#started = now();
    this.#log("info", "arc.run.started", {});
  }

  #log(level: RunLogLevel, event: string, fields: Record<string, unknown>): void {
    this.#sink(level, {
      ts: new Date().toISOString(),
      source: "arc-prompt-optimizer",
      event,
      runId: this.#meta.runId,
      transport: this.#meta.transport,
      model: this.#meta.model,
      judge: this.#meta.judge,
      rewrite: this.#meta.rewrite,
      ...(this.#meta.refine === undefined ? {} : { refine: this.#meta.refine }),
      attachments: this.#meta.attachments,
      elapsedMs: Math.round(this.#now() - this.#started),
      ...fields,
    });
  }

  step(event: StepEvent): void {
    this.#lastStep = event.step;
    this.#log("info", "arc.run.step", {
      step: event.step,
      ...(event.status === undefined ? {} : { status: event.status }),
      ...(event.round === undefined ? {} : { round: event.round }),
      ...(event.improved === undefined ? {} : { improved: event.improved }),
    });
  }

  completed(result: OptimizeResult): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#log("info", "arc.run.completed", {
      completionsUsed: result.completionsUsed,
      candidates: result.candidates.length,
      rewriteStatus: result.rewrite.status,
      ...(result.rewrite.status === "failed" ? { rewriteReason: result.rewrite.reason } : {}),
      judgeStatus: result.judge.status,
      ...(result.judge.status === "failed" ? { judgeReason: result.judge.reason } : {}),
      refineStatus: result.refine.status,
      ...(result.refine.status === "failed" ? { refineReason: result.refine.reason } : {}),
      loopRounds: result.loop.rounds,
      loopStoppedBecause: result.loop.stoppedBecause,
      revisionsFailed: result.revisions.filter((revision) => revision.status === "failed").length,
    });
  }

  failed(error: RunErrorInfo): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#log("error", "arc.run.failed", { error, ...(this.#lastStep === undefined ? {} : { lastStep: this.#lastStep }) });
  }

  cancelled(reason: RunStopReason): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#log("info", "arc.run.cancelled", { reason, ...(this.#lastStep === undefined ? {} : { lastStep: this.#lastStep }) });
  }
}
