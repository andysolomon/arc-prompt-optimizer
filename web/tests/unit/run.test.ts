import { describe, expect, it } from "vitest";
import { DEFAULT_REFINE_TEMPERATURE, REFINE_PROTOCOL, REWRITE_PROTOCOL, listPatterns } from "@/lib/arc-core/core/index.js";
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
  it("emits render, ten run steps, and rank, then returns all catalog patterns", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter() },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["render", ...Array(10).fill("run"), "rank"]);
    expect(steps[0]!.candidateIds).toHaveLength(10);
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates.slice(1).map((candidate) => candidate.prompt.pattern)).toEqual(listPatterns().map((pattern) => pattern.name));
    expect(result.ranking).toHaveLength(10);
    expect(result.completionsUsed).toBe(10);
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
        Array.from({ length: 10 }, (_, index) => index).map((index) => [questionKey(index), { type: "score", score: index / 3, confidence: 0.5, probabilities: { [String(Math.round(index / 3))]: 1 }, legend }]),
      );
      return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
    }) as typeof fetch;
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false },
      { env: { TYPESAFE_API_KEY: "k" }, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter(), fetch: fakeFetch },
    );
    expect(steps.map((s) => s.step)).toContain("judge");
    expect(result.judge.status).toBe("judged");
    // Candidate 9 scored 3/3 → judge 1.0, combined (1 + 1) / 2 = 1; candidate 0 scored 0 → combined 0.5.
    const last = result.candidates[9]!.id;
    expect(result.ranking[0]!.candidateId).toBe(last);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    expect(result.ranking[9]!.candidateId).toBe(result.baselineCandidateId);
    expect(result.ranking[9]!.quality.combined).toEqual({ status: "measured", value: 0.5 });
    expect(result.evaluations[9]!.cases[0]!.judge).toMatchObject({ status: "judged", score: 1 });
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

  it("rewrites the prompt first and ranks the rewrite as an eleventh candidate", async () => {
    const steps: StepEvent[] = [];
    const adapter = new RewritingAdapter();
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["rewrite", "render", ...Array(11).fill("run"), "rank"]);
    expect(steps[0]).toEqual({ step: "rewrite", status: "rewritten" });
    expect(steps[1]!.candidateLabels).toEqual(["Baseline", "Rewrite", "Persona", "Few-shot", "Structured reasoning", "Template fill", "Critique", "Guardrail", "Decomposition", "Audience adaptation", "Boundary"]);
    expect(result.candidates).toHaveLength(11);
    expect(result.candidates[1]!.prompt.text).toBe("You are an analyst.\nSummarize this in 3 bullets.");
    expect(result.candidates[1]!.parentCandidateId).toBe(result.baselineCandidateId);
    expect(result.ranking).toHaveLength(11);
    expect(result.completionsUsed).toBe(12);
    expect(adapter.prompts).toHaveLength(12);
    expect(adapter.prompts[2]).toBe("You are an analyst.\nSummarize this in 3 bullets.");
    expect(result.rewrite).toMatchObject({
      status: "rewritten",
      candidateId: result.candidates[1]!.id,
      analysis: ["No format."],
      changes: ["Added a role.", "Set the format."],
    });
  });

  it("continues with the baseline and all pattern candidates when the rewrite reply cannot be parsed", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter() },
    );
    expect(steps[0]).toEqual({ step: "rewrite", status: "failed" });
    expect(steps[1]!.candidateIds).toHaveLength(10);
    expect(result.candidates).toHaveLength(10);
    expect(result.rewrite.status).toBe("failed");
    expect(result.completionsUsed).toBe(11);
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
    expect(questions).toBe(11);
    expect(result.judge.status).toBe("judged");
  });
});

/**
 * Jev stub for the refine loop: the first batch call scores every candidate 1/3 except the last one at 2/3. The
 * single-candidate calls that follow (one per refined candidate) score 2/3 for round 1, so both revisions tie the
 * incumbent, then 3/3 for round 2, so the incumbent is finally beaten.
 */
function refiningJev(): { fetch: typeof fetch; calls: number[] } {
  const calls: number[] = [];
  const legend = { "0": "a", "1": "b", "2": "c", "3": "d" };
  let singles = 0;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    const keys = Object.keys(body.questions);
    calls.push(keys.length);
    if (keys.length === 1) singles += 1;
    const answers = Object.fromEntries(
      keys.map((key, index) => {
        const score = keys.length === 1 ? (singles <= 2 ? 2 : 3) : index === keys.length - 1 ? 2 : 1;
        return [key, { type: "score", score, confidence: 0.7, probabilities: { [String(score)]: 1 }, legend }];
      }),
    );
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

/** Answers refine generations with a distinct revision per call and everything else with a plain output. */
class RefiningAdapter implements CompletionAdapter {
  readonly requests: CompletionRequest[] = [];
  #revisions = 0;
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    if (request.prompt.startsWith(REFINE_PROTOCOL)) {
      this.#revisions += 1;
      return {
        text: `<analysis>\n- Too vague.\n</analysis>\n<rewritten_prompt>\nRevision ${this.#revisions}: summarize in 3 bullets.\n</rewritten_prompt>\n<changes>\n1. Change ${this.#revisions}.\n</changes>`,
        latencyMs: 30,
        usage: { inputTokens: 500, outputTokens: 60 },
      };
    }
    return { text: `output for ${request.prompt.length} chars`, latencyMs: 10, usage: { inputTokens: 10, outputTokens: 10 } };
  }
}

describe("refine", () => {
  it("iterates on the Jev winner, judges each revision, and ranks the refined candidates with the rest", async () => {
    const steps: StepEvent[] = [];
    const jev = refiningJev();
    const adapter = new RefiningAdapter();
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false, refine: { rounds: 2, variants: 2 } },
      { env: { TYPESAFE_API_KEY: "k" }, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter, fetch: jev.fetch },
    );
    expect(steps.map((s) => s.step)).toEqual(expect.arrayContaining(["judge", "refine:1", "refine:2", "rank"]));
    expect(steps.at(-1)!.step).toBe("rank");
    expect(steps.find((s) => s.step === "refine:1")).toEqual({ step: "refine:1", improved: false });
    expect(steps.find((s) => s.step === "refine:2")).toEqual({ step: "refine:2", improved: true });
    expect(result.refine.status).toBe("refined");
    if (result.refine.status !== "refined") return;
    // The first-pass winner is the last pattern candidate (scored 2/3). Round 1's revisions tie it, so round 2 refines the same incumbent.
    expect(result.refine.startCandidateId).toBe(result.candidates[9]!.id);
    expect(result.refine.rounds).toHaveLength(2);
    expect(result.refine.rounds[0]!.parentCandidateId).toBe(result.refine.startCandidateId);
    expect(result.refine.rounds[0]!.bestCandidateId).toBe(result.refine.startCandidateId);
    expect(result.refine.rounds[1]!.parentCandidateId).toBe(result.refine.startCandidateId);
    expect(result.refine.rounds[1]!.bestCandidateId).toBe(result.refine.bestCandidateId);
    expect(result.refine.stopReason).toBe("rounds_exhausted");
    // The second round's prompt lists the revisions that did not beat the incumbent.
    const secondRoundPrompt = adapter.requests.filter((request) => request.prompt.startsWith(REFINE_PROTOCOL))[2]!.prompt;
    expect(secondRoundPrompt).toContain("<rejected_revisions>");
    expect(secondRoundPrompt).toContain("Change 1.");
    expect(result.candidates).toHaveLength(14);
    expect(result.candidates.slice(10).every((candidate) => candidate.prompt.pattern === "refine")).toBe(true);
    expect(result.evaluations).toHaveLength(14);
    expect(result.ranking).toHaveLength(14);
    expect(result.ranking[0]!.candidateId).toBe(result.refine.bestCandidateId);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    // Jev answers for the refined candidates join the batch answers so the UI can show them.
    expect(result.judge.status).toBe("judged");
    if (result.judge.status === "judged") expect(Object.keys(result.judge.answers)).toHaveLength(14);
    // One batch call for the first pass, then one single-question call per refined candidate.
    expect(jev.calls).toEqual([10, 1, 1, 1, 1]);
    // 10 first-pass completions + 2 rounds × 2 × (generation + run).
    expect(result.completionsUsed).toBe(18);
    const generations = adapter.requests.filter((request) => request.prompt.startsWith(REFINE_PROTOCOL));
    expect(generations).toHaveLength(4);
    expect(generations.every((request) => request.temperature === DEFAULT_REFINE_TEMPERATURE)).toBe(true);
    expect(generations.every((request) => request.fixtureId === undefined)).toBe(true);
    expect(generations[0]!.prompt).toContain("output for");
    expect(adapter.requests.filter((request) => !request.prompt.startsWith(REFINE_PROTOCOL)).every((request) => request.temperature === undefined)).toBe(true);
  });

  it("reports a failed refine and keeps the first-pass ranking when the judge did not run", async () => {
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: false, refine: { rounds: 1, variants: 1 } },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter: new RefiningAdapter() },
    );
    expect(result.judge.status).toBe("failed");
    expect(result.refine).toEqual({ status: "failed", reason: "Refine needs Jev scores to iterate on, and the judge did not run." });
    expect(result.candidates).toHaveLength(10);
    expect(result.completionsUsed).toBe(10);
  });

  it("runs end to end on the mock providers used by the smoke test", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "anthropic/claude-haiku-4-5", judge: true, rewrite: true, refine: { rounds: 1, variants: 2 } },
      { env: { ARC_MOCK_PROVIDERS: "1" }, signal: new AbortController().signal, emit: (event) => steps.push(event) },
    );
    expect(steps.map((s) => s.step)).toContain("refine:1");
    expect(result.refine).toMatchObject({ status: "refined", stopReason: "rounds_exhausted" });
    if (result.refine.status !== "refined") return;
    expect(result.refine.rounds[0]!.attempts.map((attempt) => attempt.status)).toEqual(["evaluated", "evaluated"]);
    expect(result.refine.rounds[0]!.improved).toBe(true);
    expect(result.candidates).toHaveLength(13);
    expect(result.ranking[0]!.candidateId).toBe(result.refine.bestCandidateId);
  }, 15_000);

  it("is not requested by default", async () => {
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter: new ScriptedAdapter() },
    );
    expect(result.refine).toEqual({ status: "not_requested" });
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
    expect(peak).toBe(10);
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
    expect(aborted).toHaveLength(9);
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
