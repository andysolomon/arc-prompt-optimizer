import { describe, expect, it } from "vitest";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "@/lib/arc-core/core/index.js";
import { runOptimization } from "@/lib/optimize-run";
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
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false },
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
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true },
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
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true },
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
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter: new ScriptedAdapter() },
    );
    expect(result.judge).toEqual({ status: "failed", reason: "TYPESAFE_API_KEY is not configured." });
  });
});
