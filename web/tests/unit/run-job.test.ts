import { describe, expect, it } from "vitest";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "@/lib/arc-core/core/index.js";
import { readServerEnv } from "@/lib/env";
import { executeRun, newRunRecord, runMeta, runObserved } from "@/lib/run-job";
import { describeError, type RunLogLevel } from "@/lib/run-log";
import { MemoryRunStore } from "@/lib/run-store";
import type { OptimizeRequest } from "@/lib/types";

const env = readServerEnv({ ARC_MOCK_PROVIDERS: "1" } as unknown as NodeJS.ProcessEnv);
const input: OptimizeRequest = { prompt: "Summarize this incident report for executives.", model: "anthropic/claude-sonnet-4-5", judge: false, rewrite: true };

function collector() {
  const lines: { level: RunLogLevel; line: Record<string, unknown> }[] = [];
  return { lines, sink: (level: RunLogLevel, line: Record<string, unknown>) => lines.push({ level, line }) };
}

class FailingAdapter implements CompletionAdapter {
  async complete(): Promise<CompletionResult> {
    throw Object.assign(new Error("Provider returned 503 Service Unavailable"), { name: "APICallError", statusCode: 503 });
  }
}

class SlowAdapter implements CompletionAdapter {
  calls = 0;
  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    this.calls += 1;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 30);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Completion cancelled."), { name: "CompletionCancelledError", code: "CANCELLED" }));
      }, { once: true });
    });
    return { text: `output for ${request.prompt.length} chars`, latencyMs: 30 };
  }
}

describe("executeRun", () => {
  it("records every step, the result, and a completed log line", async () => {
    const store = new MemoryRunStore();
    const { lines, sink } = collector();
    await store.save(newRunRecord("run-ok", input));
    const record = await executeRun("run-ok", input, { env, store, sink });
    expect(record.status).toBe("done");
    expect(record.result?.completionsUsed).toBe(5);
    expect(record.steps).toHaveLength(2 + record.result!.candidates.length + 1);
    expect(record.steps[0]).toEqual({ step: "rewrite", status: "rewritten" });
    expect(record.steps.at(-1)).toEqual({ step: "rank" });
    expect(await store.get("run-ok")).toEqual(record);
    const events = lines.map((entry) => entry.line.event);
    expect(events[0]).toBe("arc.run.started");
    expect(events.filter((event) => event === "arc.run.step")).toHaveLength(record.steps.length);
    expect(events.at(-1)).toBe("arc.run.completed");
    const completed = lines.at(-1)!.line;
    expect(completed).toMatchObject({ source: "arc-prompt-optimizer", runId: "run-ok", transport: "job", model: input.model, completionsUsed: 5, rewriteStatus: "rewritten", judgeStatus: "not_requested" });
    expect(typeof completed.elapsedMs).toBe("number");
    // No prompt content leaks into the log.
    expect(JSON.stringify(lines)).not.toContain("incident report");
  });

  it("logs the client that started the run and a candidate that failed mid-run at error level", async () => {
    const store = new MemoryRunStore();
    const { lines, sink } = collector();
    let calls = 0;
    const adapter: CompletionAdapter = {
      async complete(request) {
        calls += 1;
        if (request.prompt.startsWith("<task>")) throw Object.assign(new Error("Completion timed out after 60000ms."), { name: "CompletionTimeoutError", code: "TIMEOUT" });
        return { text: `out ${request.prompt.length}`, latencyMs: 5 };
      },
    };
    const client = { mobile: true, platform: "ios", browser: "safari" } as const;
    const record = await executeRun("run-partial", { ...input, rewrite: false }, { env: {}, store, sink, adapter, client });
    expect(record.status).toBe("done");
    expect(record.result?.failures).toHaveLength(1);
    expect(calls).toBe(4);
    expect(lines[0]?.line).toMatchObject({ event: "arc.run.started", client });
    const failed = lines.find((entry) => entry.line.event === "arc.run.candidate_failed");
    expect(failed?.level).toBe("error");
    expect(failed?.line).toMatchObject({ runId: "run-partial", client, error: { kind: "timeout" } });
    expect(lines.at(-1)?.line).toMatchObject({ event: "arc.run.completed", candidates: 4, candidatesFailed: 1 });
    expect(record.steps.find((step) => step.status === "failed")?.error).toMatchObject({ kind: "timeout" });
  });

  it("stores a failure summary and logs it at error level", async () => {
    const store = new MemoryRunStore();
    const { lines, sink } = collector();
    const record = await executeRun("run-fail", input, { env, store, sink, adapter: new FailingAdapter() });
    expect(record.status).toBe("failed");
    // The run wraps the failure with the candidate that failed; the kind and status come from the cause.
    expect(record.error).toMatchObject({ kind: "provider", name: "Error", statusCode: 503 });
    expect(record.error?.message).toMatch(/^The baseline candidate failed: Provider returned 503/u);
    const failed = lines.find((entry) => entry.line.event === "arc.run.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.line).toMatchObject({ runId: "run-fail", error: record.error });
    expect((await store.get("run-fail"))?.status).toBe("failed");
  });

  it("stops at the next step when a cancel is requested and marks the run cancelled", async () => {
    const store = new MemoryRunStore();
    const { lines, sink } = collector();
    const adapter = new SlowAdapter();
    const run = executeRun("run-cancel", input, { env, store, sink, adapter });
    // Cancel while the rewrite completion is in flight; the runner sees it when the rewrite step is emitted.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.requestCancel("run-cancel");
    const record = await run;
    expect(record.status).toBe("cancelled");
    expect(record.result).toBeUndefined();
    expect(adapter.calls).toBeLessThan(5);
    expect(lines.at(-1)?.line).toMatchObject({ event: "arc.run.cancelled", reason: "cancel_requested" });
  });

  it("does not start a run that was cancelled before it began", async () => {
    const store = new MemoryRunStore();
    await store.save(newRunRecord("run-early", input));
    await store.requestCancel("run-early");
    const adapter = new SlowAdapter();
    const record = await executeRun("run-early", input, { env, store, adapter, sink: () => {} });
    expect(record.status).toBe("cancelled");
    expect(adapter.calls).toBe(0);
  });
});

describe("runObserved", () => {
  it("logs the request-bound transport and a client disconnect as cancelled", async () => {
    const { lines, sink } = collector();
    const controller = new AbortController();
    const adapter = new SlowAdapter();
    const run = runObserved(input, { env, signal: controller.signal, emit: () => {}, adapter, meta: runMeta("run-stream", "stream", input), sink });
    controller.abort();
    await expect(run).rejects.toBeDefined();
    expect(lines[0]?.line).toMatchObject({ event: "arc.run.started", transport: "stream" });
    expect(lines.at(-1)?.line).toMatchObject({ event: "arc.run.cancelled", reason: "client_disconnected" });
  });
});

describe("describeError", () => {
  it("classifies timeouts, cancellations, rate limits, provider errors, and the rest", () => {
    expect(describeError(Object.assign(new Error("Completion timed out after 60000ms."), { name: "CompletionTimeoutError", code: "TIMEOUT" })).kind).toBe("timeout");
    expect(describeError(Object.assign(new Error("x"), { name: "AbortError" })).kind).toBe("cancelled");
    expect(describeError(Object.assign(new Error("x"), { name: "APICallError", statusCode: 429 })).kind).toBe("rate_limit");
    expect(describeError(Object.assign(new Error("x"), { name: "APICallError", statusCode: 401 })).kind).toBe("provider");
    expect(describeError(new TypeError("fetch failed"))).toEqual({ kind: "unknown", name: "TypeError", message: "fetch failed" });
    expect(describeError("boom")).toMatchObject({ kind: "unknown", name: "string", message: "boom" });
    expect(describeError(new Error("y".repeat(600))).message).toHaveLength(501);
  });
});
