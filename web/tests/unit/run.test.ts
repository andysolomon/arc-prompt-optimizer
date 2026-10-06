import { describe, expect, it } from "vitest";
import { REWRITE_PROTOCOL } from "@/lib/arc-core/core/index.js";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "@/lib/arc-core/core/index.js";
import { COMPLETION_TIMEOUT_MS, SLOW_COMPLETION_TIMEOUT_MS, completionTimeoutMs, runOptimization } from "@/lib/optimize-run";
import { questionKey } from "@/lib/jev";
import type { StepEvent } from "@/lib/types";

class ScriptedAdapter implements CompletionAdapter {
  calls = 0;
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls += 1;
    return { text: `output ${this.calls} for ${request.prompt.length} chars`, latencyMs: 100 * this.calls, usage: { inputTokens: 10, outputTokens: 5 * this.calls } };
  }
}

describe("runOptimization", () => {
  it("emits render, four run steps, and rank, then returns four ranked candidates", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter() },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["render", "run", "run", "run", "run", "rank"]);
    expect(steps[0]!.candidateIds).toHaveLength(4);
    expect(result.candidates).toHaveLength(4);
    expect(result.ranking).toHaveLength(4);
    expect(result.completionsUsed).toBe(4);
    expect(result.judge).toEqual({ status: "not_requested" });
    // Deterministic preview checks tie at 1.00 and are broken by total tokens: the baseline ran first with the fewest tokens.
    expect(result.ranking[0]!.candidateId).toBe(result.baselineCandidateId);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    expect(result.ranking[1]!.tieBrokenBy).toBe("totalTokens");
  });

  it("feeds normalized Jev scores into the ranking with equal weights", async () => {
    const steps: StepEvent[] = [];
    const legend = { "0": "a", "1": "b", "2": "c", "3": "d" };
    const fakeFetch = (async () => {
      const answers = Object.fromEntries(
        [0, 1, 2, 3].map((index) => [questionKey(index), { type: "score", score: index, confidence: 0.5, probabilities: { [String(index)]: 1 }, legend }]),
      );
      return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
    }) as typeof fetch;
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false },
      { env: { TYPESAFE_API_KEY: "k" }, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter(), fetch: fakeFetch },
    );
    expect(steps.map((s) => s.step)).toContain("judge");
    expect(result.judge.status).toBe("judged");
    // Candidate 3 scored 3/3 → judge 1.0, combined (1 + 1) / 2 = 1; candidate 0 scored 0 → combined 0.5.
    const last = result.candidates[3]!.id;
    expect(result.ranking[0]!.candidateId).toBe(last);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    expect(result.ranking[3]!.candidateId).toBe(result.baselineCandidateId);
    expect(result.ranking[3]!.quality.combined).toEqual({ status: "measured", value: 0.5 });
    expect(result.evaluations[3]!.cases[0]!.judge).toMatchObject({ status: "judged", score: 1 });
  });

  it("falls back to the deterministic ranking when TypeSafe fails", async () => {
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false },
      {
        env: { TYPESAFE_API_KEY: "k" },
        signal: new AbortController().signal,
        emit: () => {},
        adapter: new ScriptedAdapter(),
        fetch: (async () => new Response("err", { status: 500 })) as typeof fetch,
      },
    );
    expect(result.judge).toEqual({ status: "failed", reason: "TypeSafe responded with HTTP 500." });
    expect(result.ranking.every((r) => r.quality.combined.status === "measured" && r.quality.combined.value === 1)).toBe(true);
  });

  it("reports a failed judge when the key is missing instead of calling out", async () => {
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter: new ScriptedAdapter() },
    );
    expect(result.judge).toEqual({ status: "failed", reason: "TYPESAFE_API_KEY is not configured." });
  });

  it("rewrites the prompt first and ranks the rewrite as a fifth candidate", async () => {
    const steps: StepEvent[] = [];
    const adapter = new RewritingAdapter();
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["rewrite", "render", "run", "run", "run", "run", "run", "rank"]);
    expect(steps[0]).toEqual({ step: "rewrite", status: "rewritten" });
    expect(steps[1]!.candidateLabels).toEqual(["Baseline", "Rewrite", "Critique", "Decomposition", "Structured reasoning"]);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[1]!.prompt.text).toBe("You are an analyst.\nSummarize this in 3 bullets.");
    expect(result.candidates[1]!.parentCandidateId).toBe(result.baselineCandidateId);
    expect(result.ranking).toHaveLength(5);
    expect(result.completionsUsed).toBe(6);
    expect(adapter.prompts).toHaveLength(6);
    expect(adapter.prompts[2]).toBe("You are an analyst.\nSummarize this in 3 bullets.");
    expect(result.rewrite).toMatchObject({
      status: "rewritten",
      candidateId: result.candidates[1]!.id,
      analysis: ["No format."],
      changes: ["Added a role.", "Set the format."],
    });
  });

  it("continues with the four preview candidates when the rewrite reply cannot be parsed", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter() },
    );
    expect(steps[0]).toEqual({ step: "rewrite", status: "failed" });
    expect(steps[1]!.candidateIds).toHaveLength(4);
    expect(result.candidates).toHaveLength(4);
    expect(result.rewrite.status).toBe("failed");
    expect(result.completionsUsed).toBe(5);
  });

  it("stops the run when it is cancelled during the rewrite", async () => {
    const controller = new AbortController();
    const hanging: CompletionAdapter = { complete: () => new Promise(() => {}) };
    const run = runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: controller.signal, emit: () => {}, adapter: hanging },
    );
    controller.abort();
    await expect(run).rejects.toThrow(/cancelled/iu);
  });

  it("asks Jev one Score question per candidate, including the rewrite", async () => {
    let questions = 0;
    const legend = { "0": "a", "1": "b", "2": "c", "3": "d" };
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
      questions = Object.keys(body.questions).length;
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((key) => [key, { type: "score", score: 2, confidence: 0.5, probabilities: { "2": 1 }, legend }]),
      );
      return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
    }) as typeof fetch;
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: true, rewrite: true },
      { env: { TYPESAFE_API_KEY: "k" }, signal: new AbortController().signal, emit: () => {}, adapter: new RewritingAdapter(), fetch: fakeFetch },
    );
    expect(questions).toBe(5);
    expect(result.judge.status).toBe("judged");
  });
});

describe("concurrent candidate runs", () => {
  it("gives the slow gateways a longer per-completion timeout", () => {
    expect(completionTimeoutMs("openai/gpt-5-mini")).toBe(COMPLETION_TIMEOUT_MS);
    expect(completionTimeoutMs("minimax/MiniMax-M3")).toBe(SLOW_COMPLETION_TIMEOUT_MS);
    expect(completionTimeoutMs("opencode-go/glm-5.3")).toBe(SLOW_COMPLETION_TIMEOUT_MS);
  });

  it("starts every candidate before any finishes", async () => {
    let inFlight = 0;
    let peak = 0;
    const adapter: CompletionAdapter = {
      async complete(request) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { text: `out ${request.prompt.length}` };
      },
    };
    await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(peak).toBe(4);
  });

  it("names the failing candidate and aborts the others", async () => {
    const aborted: string[] = [];
    const adapter: CompletionAdapter = {
      complete(request, signal) {
        if (request.prompt.startsWith("<task>")) return Promise.reject(new Error("provider overloaded"));
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted.push(request.prompt.slice(0, 10));
            reject(new Error("aborted"));
          });
        });
      },
    };
    const run = runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    await expect(run).rejects.toThrow("The critique candidate failed: provider overloaded");
    expect(aborted).toHaveLength(3);
  });
});

/** Answers the rewrite meta-prompt with a parseable reply and every other prompt with a short output. */
class RewritingAdapter implements CompletionAdapter {
  readonly prompts: string[] = [];
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.prompts.push(request.prompt);
    if (request.prompt.startsWith(REWRITE_PROTOCOL)) {
      return {
        text: "<analysis>\n- No format.\n</analysis>\n<rewritten_prompt>\nYou are an analyst.\nSummarize this in 3 bullets.\n</rewritten_prompt>\n<changes>\n1. Added a role.\n2. Set the format.\n</changes>",
        latencyMs: 50,
        usage: { inputTokens: 900, outputTokens: 120 },
      };
    }
    return { text: `output for ${request.prompt.length} chars`, latencyMs: 10, usage: { inputTokens: 10, outputTokens: 10 } };
  }
}
