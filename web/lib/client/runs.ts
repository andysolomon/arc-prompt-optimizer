import { OptimizeRequestError } from "@/lib/client/sse";
import type { OptimizeRequestBody, OptimizeResult, RunErrorInfo, StepEvent } from "@/lib/types";

export { OptimizeRequestError };

export type RunStatus = "running" | "done" | "failed" | "cancelled";

export interface RunStatusResponse {
  readonly id: string;
  readonly status: RunStatus;
  readonly createdAt: number;
  readonly steps: readonly StepEvent[];
  readonly result?: OptimizeResult;
  readonly error?: RunErrorInfo;
}

export const RUNS_ENDPOINT = "/api/optimize/runs";
/** Time between polls while the page is visible; a visibility or connectivity change polls at once. */
export const POLL_INTERVAL_MS = 1_500;
/** Give up following a run this long after this page started following it; the server bounds a run at 300 s. */
export const MAX_FOLLOW_MS = 8 * 60 * 1000;

/** The run was cancelled on the server (by this or another tab). */
export class RunCancelledError extends Error {
  constructor() {
    super("The run was cancelled.");
    this.name = "RunCancelledError";
  }
}

/** The run ended `failed` on the server; carries the server's error summary so the UI can explain it. */
export class RunFailedError extends Error {
  readonly kind: RunErrorInfo["kind"];
  readonly statusCode: number | undefined;
  /** The last step that completed before the failure, when the record shows one. */
  readonly lastStep: string | undefined;
  constructor(error: RunErrorInfo | undefined, lastStep?: string) {
    super(error?.message ?? "Optimization failed.");
    this.name = "RunFailedError";
    this.kind = error?.kind ?? "unknown";
    this.statusCode = error?.statusCode;
    this.lastStep = lastStep;
  }
}

/** This page could not reach the server, or the run did not finish, before the page's own deadline. */
export class RunLostError extends Error {
  readonly reason: "unreachable" | "overdue";
  constructor(reason: "unreachable" | "overdue") {
    super(reason === "unreachable" ? "Lost contact with the server while the run was in progress. Check your connection and start it again." : "The run did not finish in time. Start it again.");
    this.name = "RunLostError";
    this.reason = reason;
  }
}

/** The server no longer has the run: it expired, was collected by another tab, or the instance that held it is gone. */
export class RunUnavailableError extends Error {
  constructor(message = "This run is no longer available. Start it again.") {
    super(message);
    this.name = "RunUnavailableError";
  }
}

async function errorFrom(response: Response): Promise<OptimizeRequestError> {
  let message = `Request failed with HTTP ${response.status}.`;
  try {
    const json = (await response.json()) as { error?: unknown };
    if (typeof json.error === "string") message = json.error;
  } catch {
    /* non-JSON error body */
  }
  return new OptimizeRequestError(response.status, message);
}

/** Starts a background run and resolves with its id. Rejects with `OptimizeRequestError` on a 4xx/5xx. */
export async function startRun(body: OptimizeRequestBody, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<string> {
  const response = await fetchFn(RUNS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await errorFrom(response);
  const json = (await response.json()) as { id?: unknown };
  if (typeof json.id !== "string") throw new Error("The server returned no run id.");
  return json.id;
}

/** Cancels a running run or discards a finished one. Failures are ignored: the server expires the run anyway. */
export async function discardRun(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    await fetchFn(`${RUNS_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
  } catch {
    /* best effort */
  }
}

function abortError(): Error {
  return typeof DOMException === "function" ? new DOMException("The run was abandoned by this page.", "AbortError") : Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/**
 * Waits `ms`, or less when the page becomes visible again or comes back online, since those are the moments a
 * returning user wants the latest state.
 */
export function waitForNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const hasDocument = typeof document !== "undefined";
    const hasWindow = typeof window !== "undefined";
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (hasDocument) document.removeEventListener("visibilitychange", onVisible);
      if (hasWindow) window.removeEventListener("online", onVisible);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    const onVisible = () => {
      if (!hasDocument || document.visibilityState === "visible") finish();
    };
    const timer = setTimeout(() => finish(), ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (hasDocument) document.addEventListener("visibilitychange", onVisible);
    if (hasWindow) window.addEventListener("online", onVisible);
  });
}

export interface FollowRunOptions {
  readonly fetch?: typeof fetch;
  readonly intervalMs?: number;
  readonly maxFollowMs?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Polls a run until it finishes, reporting each new step once, and resolves with the result. Network errors (a
 * phone that switched apps, a dropped connection) do not end the run: polling keeps retrying until the run's
 * deadline passes. Aborting `signal` only stops following; use `discardRun` to cancel on the server.
 */
export async function followRun(id: string, signal: AbortSignal, onStep: (event: StepEvent) => void, options: FollowRunOptions = {}): Promise<OptimizeResult> {
  const fetchFn = options.fetch ?? fetch;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const maxFollowMs = options.maxFollowMs ?? MAX_FOLLOW_MS;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForNextPoll;
  const url = `${RUNS_ENDPOINT}?id=${encodeURIComponent(id)}`;
  let applied = 0;
  // Measured on this clock, not the server's `createdAt`, so clock skew cannot end a run early.
  const deadline = now() + maxFollowMs;
  for (;;) {
    if (signal.aborted) throw abortError();
    let response: Response | undefined;
    try {
      response = await fetchFn(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal });
    } catch (error) {
      if (signal.aborted) throw abortError();
      // Unreachable server: keep trying until the run's own deadline.
      if (now() > deadline) throw new RunLostError("unreachable");
      void error;
    }
    if (response !== undefined) {
      if (response.status === 404) throw new RunUnavailableError();
      if (response.ok) {
        const record = (await response.json()) as RunStatusResponse;
        for (const event of record.steps.slice(applied)) onStep(event);
        applied = record.steps.length;
        if (record.status === "done" && record.result !== undefined) return record.result;
        if (record.status === "failed") throw new RunFailedError(record.error, record.steps.at(-1)?.step);
        if (record.status === "cancelled") throw new RunCancelledError();
        if (now() > deadline) throw new RunLostError("overdue");
      } else if (response.status >= 500 || response.status === 429) {
        // Transient server trouble: retry on the next poll.
        if (now() > deadline) throw await errorFrom(response);
      } else {
        throw await errorFrom(response);
      }
    }
    await wait(intervalMs, signal);
  }
}
