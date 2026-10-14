import { describe, expect, it } from "vitest";
import { RunCancelledError, RunFailedError, RunLostError, RunUnavailableError, followRun, startRun, type RunStatusResponse } from "@/lib/client/runs";
import { OptimizeRequestError } from "@/lib/client/sse";
import type { OptimizeResult } from "@/lib/types";

const RESULT = { completionsUsed: 5, candidates: [] } as unknown as OptimizeResult;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Serves one scripted response per poll; a function entry throws to simulate a network failure. */
function scripted(responses: (RunStatusResponse | Response | (() => never))[]) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${typeof input === "string" ? input : String(input)}`);
    const next = responses.shift();
    if (next === undefined) throw new Error("no more scripted responses");
    if (typeof next === "function") return next();
    return next instanceof Response ? next : json(next);
  }) as typeof fetch;
  return { calls, fetchFn };
}

const running = (steps: RunStatusResponse["steps"]): RunStatusResponse => ({ id: "r1", status: "running", createdAt: 1_000, steps });
const immediate = async () => {};

describe("startRun", () => {
  it("posts the body and returns the id", async () => {
    const { calls, fetchFn } = scripted([json({ id: "r1", status: "running" }, 202)]);
    expect(await startRun({ prompt: "p", model: "openai/gpt-5-mini", judge: false }, undefined, fetchFn)).toBe("r1");
    expect(calls).toEqual(["POST /api/optimize/runs"]);
  });

  it("surfaces the server's error message and status", async () => {
    const { fetchFn } = scripted([json({ error: "Prompt must not be empty." }, 400)]);
    await expect(startRun({ prompt: "", model: "openai/gpt-5-mini", judge: false }, undefined, fetchFn)).rejects.toMatchObject({ status: 400, message: "Prompt must not be empty." });
    const { fetchFn: limited } = scripted([json({ error: "Rate limit reached" }, 429)]);
    await expect(startRun({ prompt: "p", model: "openai/gpt-5-mini", judge: false }, undefined, limited)).rejects.toBeInstanceOf(OptimizeRequestError);
  });
});

describe("followRun", () => {
  it("reports each new step once and resolves with the result", async () => {
    const steps: string[] = [];
    const { calls, fetchFn } = scripted([
      running([{ step: "rewrite", status: "rewritten" }]),
      running([{ step: "rewrite", status: "rewritten" }, { step: "render", candidateIds: ["a"] }]),
      { ...running([{ step: "rewrite", status: "rewritten" }, { step: "render", candidateIds: ["a"] }, { step: "run:a" }, { step: "rank" }]), status: "done", result: RESULT },
    ]);
    const result = await followRun("r1", new AbortController().signal, (event) => steps.push(event.step), { fetch: fetchFn, wait: immediate });
    expect(result).toEqual(RESULT);
    expect(steps).toEqual(["rewrite", "render", "run:a", "rank"]);
    expect(calls).toEqual(Array(3).fill("GET /api/optimize/runs?id=r1"));
  });

  it("keeps polling through network failures until the run finishes", async () => {
    const { calls, fetchFn } = scripted([
      running([]),
      () => { throw new TypeError("Load failed"); },
      () => { throw new TypeError("Load failed"); },
      json({ error: "upstream" }, 502),
      { ...running([{ step: "rank" }]), status: "done", result: RESULT },
    ]);
    await expect(followRun("r1", new AbortController().signal, () => {}, { fetch: fetchFn, wait: immediate })).resolves.toEqual(RESULT);
    expect(calls).toHaveLength(5);
  });

  it("gives up once the run's deadline has passed without contact", async () => {
    let now = 1_000;
    const { fetchFn } = scripted([running([]), () => { throw new TypeError("Load failed"); }, () => { throw new TypeError("Load failed"); }]);
    const follow = followRun("r1", new AbortController().signal, () => {}, { fetch: fetchFn, wait: async () => { now += 60_000; }, now: () => now, maxFollowMs: 90_000 });
    await expect(follow).rejects.toThrow(/Lost contact with the server/u);
    await expect(follow).rejects.toMatchObject({ name: "RunLostError", reason: "unreachable" });
  });

  it("fails with the server's error summary, a cancellation, or an expired run", async () => {
    const failed = scripted([{ ...running([{ step: "rewrite", status: "rewritten" }, { step: "render", candidateIds: ["a"] }]), status: "failed", error: { kind: "timeout", name: "Error", message: "The baseline candidate failed: Completion timed out after 120000ms." } }]);
    const failure = await followRun("r1", new AbortController().signal, () => {}, { fetch: failed.fetchFn, wait: immediate }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunFailedError);
    // The page keeps the kind and the last step reached so it can explain the failure and name where it stopped.
    expect(failure).toMatchObject({ kind: "timeout", lastStep: "render", message: "The baseline candidate failed: Completion timed out after 120000ms." });
    const rejected = scripted([{ ...running([]), status: "failed", error: { kind: "provider", name: "APICallError", message: "Provider returned 503", statusCode: 503 } }]);
    await expect(followRun("r1", new AbortController().signal, () => {}, { fetch: rejected.fetchFn, wait: immediate })).rejects.toMatchObject({ kind: "provider", statusCode: 503, lastStep: undefined });
    const cancelled = scripted([{ ...running([]), status: "cancelled" }]);
    await expect(followRun("r1", new AbortController().signal, () => {}, { fetch: cancelled.fetchFn, wait: immediate })).rejects.toBeInstanceOf(RunCancelledError);
    const gone = scripted([json({ error: "This run is no longer available." }, 404)]);
    await expect(followRun("r1", new AbortController().signal, () => {}, { fetch: gone.fetchFn, wait: immediate })).rejects.toBeInstanceOf(RunUnavailableError);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const { fetchFn } = scripted([running([]), running([])]);
    const follow = followRun("r1", controller.signal, () => {}, { fetch: fetchFn, wait: async (_ms, signal) => { controller.abort(); if (signal.aborted) throw new DOMException("aborted", "AbortError"); } });
    await expect(follow).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("RunLostError", () => {
  it("names the reason the page gave up", () => {
    expect(new RunLostError("overdue").message).toBe("The run did not finish in time. Start it again.");
    expect(new RunLostError("unreachable").reason).toBe("unreachable");
  });
});
