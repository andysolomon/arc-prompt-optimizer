import "server-only";
import type { ServerEnv } from "@/lib/env";
import { runOptimization, type RunOptions } from "@/lib/optimize-run";
import { RunObserver, describeError, type RunLogSink, type RunMeta, type RunTransport } from "@/lib/run-log";
import type { RunRecord, RunStore } from "@/lib/run-store";
import { attachmentInfo, type OptimizeRequest, type OptimizeResult, type StepEvent } from "@/lib/types";

export function runMeta(runId: string, transport: RunTransport, input: OptimizeRequest): RunMeta {
  return {
    runId,
    transport,
    model: input.model,
    judge: input.judge,
    rewrite: input.rewrite,
    ...(input.refine === undefined ? {} : { refine: input.refine }),
    attachments: input.attachments?.length ?? 0,
  };
}

export function newRunRecord(id: string, input: OptimizeRequest, now = Date.now()): RunRecord {
  return {
    id,
    status: "running",
    model: input.model,
    judge: input.judge,
    rewrite: input.rewrite,
    ...(input.refine === undefined ? {} : { refine: input.refine }),
    ...(input.attachments === undefined || input.attachments.length === 0 ? {} : { attachments: attachmentInfo(input.attachments) }),
    createdAt: now,
    updatedAt: now,
    steps: [],
  };
}

export interface ObservedRunOptions extends RunOptions {
  readonly meta: RunMeta;
  readonly sink?: RunLogSink;
}

/**
 * `runOptimization` with lifecycle logging: used by the request-bound route, where cancellation means the client
 * disconnected. Rethrows so the caller's error handling is unchanged.
 */
export async function runObserved(input: OptimizeRequest, options: ObservedRunOptions): Promise<OptimizeResult> {
  const observer = new RunObserver(options.meta, options.sink);
  try {
    const result = await runOptimization(input, {
      ...options,
      emit: (event) => {
        observer.step(event);
        options.emit(event);
      },
    });
    observer.completed(result);
    return result;
  } catch (error) {
    if (options.signal.aborted) observer.cancelled("client_disconnected");
    else observer.failed(describeError(error));
    throw error;
  }
}

export interface ExecuteRunOptions {
  readonly env: ServerEnv;
  readonly store: RunStore;
  readonly sink?: RunLogSink;
  readonly now?: () => number;
  /** Test seams forwarded to the run. */
  readonly adapter?: RunOptions["adapter"];
  readonly fetch?: RunOptions["fetch"];
  readonly budgetMs?: RunOptions["budgetMs"];
}

/**
 * Executes one background run to completion, detached from any client connection. Each step is appended to the
 * stored record so a client can poll it, and a cancel request stored between steps aborts the run. The record ends
 * `done` with the result, `failed` with an error summary, or `cancelled`.
 */
export async function executeRun(id: string, input: OptimizeRequest, options: ExecuteRunOptions): Promise<RunRecord> {
  const now = options.now ?? Date.now;
  const { store } = options;
  const controller = new AbortController();
  const observer = new RunObserver(runMeta(id, "job", input), options.sink);
  let record: RunRecord = (await store.get(id)) ?? newRunRecord(id, input, now());
  let writes: Promise<void> = Promise.resolve();
  const persist = (patch: Partial<RunRecord>): Promise<void> => {
    record = { ...record, ...patch, updatedAt: now() };
    const snapshot = record;
    writes = writes.then(() => store.save(snapshot)).catch((error: unknown) => {
      options.sink?.("error", { event: "arc.run.store_failed", runId: id, error: describeError(error) });
      if (options.sink === undefined) console.error(JSON.stringify({ ts: new Date().toISOString(), source: "arc-prompt-optimizer", event: "arc.run.store_failed", runId: id, error: describeError(error) }));
    });
    return writes;
  };
  const emit = (event: StepEvent): void => {
    observer.step(event);
    void persist({ steps: [...record.steps, event] });
    void store
      .cancelRequested(id)
      .then((cancel) => {
        if (cancel) controller.abort();
      })
      .catch(() => {});
  };
  if (await store.cancelRequested(id).catch(() => false)) controller.abort();
  try {
    const result = await runOptimization(input, {
      env: options.env,
      signal: controller.signal,
      emit,
      ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    });
    observer.completed(result);
    await persist({ status: "done", result });
  } catch (error) {
    if (controller.signal.aborted) {
      observer.cancelled("cancel_requested");
      await persist({ status: "cancelled" });
    } else {
      const info = describeError(error);
      observer.failed(info);
      await persist({ status: "failed", error: info });
    }
  }
  await writes;
  return record;
}
