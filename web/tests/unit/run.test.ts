import { describe, expect, it } from "vitest";
import { FALLBACK_PATTERNS, REVISE_PROTOCOL, REWRITE_FORMAT_REMINDER, REWRITE_PROTOCOL } from "@/lib/arc-core/core/index.js";
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

function rewriteReply(prompt: string, plan?: Record<string, unknown>): string {
  return [
    "<analysis>\n- No format.\n</analysis>",
    `<rewritten_prompt>\n${prompt}\n</rewritten_prompt>`,
    "<changes>\n1. Added a role.\n2. Set the format.\n</changes>",
    ...(plan === undefined ? [] : [`<plan>\n${JSON.stringify(plan)}\n</plan>`]),
  ].join("\n");
}

function reviseReply(prompt: string): string {
  return `<analysis>\n- The limit was buried.\n</analysis>\n<rewritten_prompt>\n${prompt}\n</rewritten_prompt>\n<changes>\n1. Moved the limit up.\n</changes>`;
}

const REWRITTEN = "You are an analyst.\nSummarize this in 3 bullets.";

/**
 * Answers the rewrite meta-prompt with a parseable reply (and a plan when given), the revise meta-prompt with a
 * revision, and every other prompt through `output`, which sees the candidate prompt and the completion index.
 */
class RewritingAdapter implements CompletionAdapter {
  readonly prompts: string[] = [];
  readonly #plan: Record<string, unknown> | undefined;
  readonly #output: (prompt: string, index: number) => string;
  #revision = 0;

  constructor(plan?: Record<string, unknown>, output: (prompt: string, index: number) => string = (prompt) => `output for ${prompt.length} chars`) {
    this.#plan = plan;
    this.#output = output;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.prompts.push(request.prompt);
    if (request.prompt.includes(REWRITE_PROTOCOL)) {
      return { text: rewriteReply(REWRITTEN, this.#plan), latencyMs: 50, usage: { inputTokens: 900, outputTokens: 120 } };
    }
    if (request.prompt.includes(REVISE_PROTOCOL)) {
      this.#revision += 1;
      return { text: reviseReply(`Use at most 10 words. (revision ${this.#revision})\n${REWRITTEN}`), latencyMs: 40, usage: { inputTokens: 500, outputTokens: 80 } };
    }
    return { text: this.#output(request.prompt, this.prompts.length), latencyMs: 10, usage: { inputTokens: 10, outputTokens: 10 } };
  }
}

const PLAN = {
  task_type: "summarization",
  temperature: 0.3,
  criteria: { max_words: 5, required_keywords: ["summary"] },
  patterns: [{ pattern: "persona", variables: { role: "an analyst", experience: "ten years", style: "terse", priority: "accuracy" } }, "critique"],
};

describe("runOptimization", () => {
  it("without the rewrite, runs the baseline and the fallback pattern trio against the non-empty check", async () => {
    const steps: StepEvent[] = [];
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter: new ScriptedAdapter() },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["render", ...Array(4).fill("run"), "rank"]);
    expect(steps[0]!.candidateIds).toHaveLength(4);
    expect(result.candidates.slice(1).map((candidate) => candidate.prompt.pattern)).toEqual([...FALLBACK_PATTERNS]);
    expect(result.ranking).toHaveLength(4);
    expect(result.completionsUsed).toBe(4);
    expect(result.judge).toEqual({ status: "not_requested" });
    expect(result.plan).toEqual({ status: "default", reason: "The rewrite was not requested, so no task criteria were planned.", suiteId: "prompt-optimize-preview", patterns: [...FALLBACK_PATTERNS] });
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "not_requested" });
    // The non-empty check ties at 1.00 and is broken by total tokens: the baseline ran first with the fewest tokens.
    expect(result.ranking[0]!.candidateId).toBe(result.baselineCandidateId);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    expect(result.ranking[1]!.tieBrokenBy).toBe("totalTokens");
  });

  it("feeds normalized Jev scores into the ranking with equal weights", async () => {
    const steps: StepEvent[] = [];
    const legend = { "0": "a", "1": "b", "2": "c", "3": "d" };
    const fakeFetch = (async () => {
      const answers = Object.fromEntries(
        Array.from({ length: 4 }, (_, index) => index).map((index) => [questionKey(index), { type: "score", score: index, confidence: 0.5, probabilities: { [String(index)]: 1 }, legend }]),
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

  it("rewrites the prompt first, renders the plan's patterns, and scores everything against the planned checks", async () => {
    const steps: StepEvent[] = [];
    // Every output passes the plan's checks, so the loop stops after the first round.
    const adapter = new RewritingAdapter(PLAN, () => "A short summary here.");
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["rewrite", "render", ...Array(4).fill("run"), "rank"]);
    expect(steps[0]).toEqual({ step: "rewrite", status: "rewritten" });
    expect(steps[1]!.candidateLabels).toEqual(["Baseline", "Rewrite", "Persona", "Critique"]);
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[1]!.prompt.text).toBe(REWRITTEN);
    expect(result.candidates[1]!.parentCandidateId).toBe(result.baselineCandidateId);
    expect(result.candidates[2]!.prompt.text).toContain("You are an analyst with ten years.");
    expect(result.completionsUsed).toBe(5);
    expect(adapter.prompts).toHaveLength(5);
    expect(adapter.prompts[2]).toBe(REWRITTEN);
    expect(result.rewrite).toMatchObject({ status: "rewritten", candidateId: result.candidates[1]!.id, analysis: ["No format."], changes: ["Added a role.", "Set the format."], attempts: 1 });
    expect(result.plan).toEqual({
      status: "planned",
      taskType: "summarization",
      temperature: 0.3,
      criteria: { maxWords: 5, requiredKeywords: ["summary"], forbiddenPhrases: [] },
      suiteId: result.evaluations[0]!.cases[0]!.caseId === "task" ? result.plan.suiteId : "",
      patterns: ["persona", "critique"],
    });
    expect(result.plan.suiteId).toMatch(/^plan-[0-9a-f]{8}$/u);
    expect(result.evaluations[1]!.cases[0]!.deterministic.checks.map((check) => check.criterion)).toEqual(["max_words", "required_keyword", "min_characters"]);
    expect(result.ranking.every((r) => r.quality.combined.status === "measured" && r.quality.combined.value === 1)).toBe(true);
    expect(result.revisions).toEqual([]);
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "all_checks_passed" });
  });

  it("revises the rewrite for the checks it failed, runs the revision, and ranks it", async () => {
    const steps: StepEvent[] = [];
    // The rewrite's output is too long; the first revision's output passes.
    const adapter = new RewritingAdapter(PLAN, (prompt) => (prompt.startsWith("Use at most 10 words.") ? "A short summary here." : "This summary runs on far longer than five words allow."));
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps.map((s) => s.step.split(":")[0])).toEqual(["rewrite", "render", ...Array(4).fill("run"), "revise", "run", "rank"]);
    const revise = steps.find((s) => s.step === "revise")!;
    expect(revise).toMatchObject({ status: "revised", round: 2, candidateLabel: "Rewrite v2" });
    expect(result.candidates).toHaveLength(5);
    const revision = result.candidates[4]!;
    expect(revision.id).toBe(revise.candidateId);
    expect(revision.metadata).toEqual({ label: "rewrite_v2", revision: 2 });
    expect(revision.parentCandidateId).toBe(result.rewrite.status === "rewritten" ? result.rewrite.candidateId : "");
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ status: "revised", round: 2, candidateId: revision.id, targeted: ["max_words"], analysis: ["The limit was buried."], changes: ["Moved the limit up."], attempts: 1 });
    expect(result.loop).toEqual({ rounds: 1, stoppedBecause: "all_checks_passed" });
    expect(result.completionsUsed).toBe(7);
    // The revise prompt names only the failed check and carries the failed output.
    const revisePrompt = adapter.prompts.find((prompt) => prompt.includes(REVISE_PROTOCOL))!;
    expect(revisePrompt).toContain("- max_words: expected 5, got 10");
    expect(revisePrompt).not.toContain("required_keyword");
    expect(revisePrompt).toContain("This summary runs on far longer");
    // The revision outscores its parent: 3/3 checks against 2/3.
    const rewriteRank = result.ranking.find((entry) => entry.candidateId === result.candidates[1]!.id)!;
    const revisionRank = result.ranking.find((entry) => entry.candidateId === revision.id)!;
    expect(revisionRank.quality.combined).toEqual({ status: "measured", value: 1 });
    expect(rewriteRank.quality.combined).toMatchObject({ status: "measured" });
    expect((rewriteRank.quality.combined as { value: number }).value).toBeCloseTo(2 / 3);
    expect(result.ranking[0]!.candidateId).toBe(revision.id);
  });

  it("stops revising at the round limit when checks keep failing", async () => {
    const adapter = new RewritingAdapter(PLAN, () => "This summary runs on far longer than five words allow.");
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(result.revisions.map((revision) => revision.round)).toEqual([2, 3]);
    expect(result.candidates.map((candidate) => candidate.metadata?.label)).toEqual(["baseline", "rewrite", "persona", "critique", "rewrite_v2", "rewrite_v3"]);
    expect(result.candidates[5]!.parentCandidateId).toBe(result.candidates[4]!.id);
    expect(result.loop).toEqual({ rounds: 2, stoppedBecause: "max_rounds" });
    expect(result.completionsUsed).toBe(9);
  });

  it("skips revising when another round would not fit the time budget", async () => {
    let clock = 0;
    const adapter = new RewritingAdapter(PLAN, () => "far too many words for the five word limit here");
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter, budgetMs: 15_000, now: () => (clock += 5_000) },
    );
    expect(result.revisions).toEqual([]);
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "time_budget" });
    expect(result.completionsUsed).toBe(5);
  });

  it("does not revise without planned criteria and says so", async () => {
    const adapter = new RewritingAdapter(undefined, () => "x");
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(result.plan).toEqual({ status: "default", reason: "The rewrite reply carried no readable plan.", suiteId: "prompt-optimize-preview", patterns: [...FALLBACK_PATTERNS] });
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "no_criteria" });
    expect(result.candidates).toHaveLength(5);
  });

  it("keeps the previous version when the revision reply cannot be parsed", async () => {
    const steps: StepEvent[] = [];
    const adapter: CompletionAdapter = {
      async complete(request) {
        if (request.prompt.includes(REWRITE_PROTOCOL)) return { text: rewriteReply(REWRITTEN, PLAN) };
        if (request.prompt.includes(REVISE_PROTOCOL)) return { text: "I would suggest shortening it." };
        return { text: "This summary runs on far longer than five words allow." };
      },
    };
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps.find((s) => s.step === "revise")).toEqual({ step: "revise", status: "failed", round: 2 });
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ status: "failed", round: 2, targeted: ["max_words"], attempts: 2 });
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "revision_failed" });
    expect(result.candidates).toHaveLength(4);
    expect(result.completionsUsed).toBe(7);
  });

  it("retries a malformed rewrite reply once, then continues with the baseline and the fallback trio", async () => {
    const steps: StepEvent[] = [];
    const prompts: string[] = [];
    const adapter: CompletionAdapter = {
      async complete(request) {
        prompts.push(request.prompt);
        return { text: "Sure, here is a better prompt.", finishReason: "stop" };
      },
    };
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(steps[0]).toEqual({ step: "rewrite", status: "failed" });
    expect(prompts[1]!.startsWith(REWRITE_FORMAT_REMINDER)).toBe(true);
    expect(steps[1]!.candidateIds).toHaveLength(4);
    expect(result.candidates).toHaveLength(4);
    expect(result.rewrite).toMatchObject({ status: "failed", attempts: 2 });
    expect(result.rewrite.status === "failed" ? result.rewrite.reason : "").toMatch(/no complete <rewritten_prompt> section/u);
    expect(result.plan).toMatchObject({ status: "default", reason: "The rewrite failed, so no task criteria were planned." });
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "rewrite_failed" });
    expect(result.completionsUsed).toBe(6);
  });

  it("names the output limit when the rewrite reply was cut off", async () => {
    const adapter: CompletionAdapter = {
      async complete(request) {
        if (request.prompt.includes(REWRITE_PROTOCOL)) return { text: "<analysis>\n- x\n</analysis>\n<rewritten_prompt>\nYou are", finishReason: "length" };
        return { text: "out" };
      },
    };
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "opencode-go/glm-5.3", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(result.rewrite.status === "failed" ? result.rewrite.reason : "").toMatch(/cut off at the output limit/u);
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

  it("asks Jev one Score question per candidate, including the rewrite and its revisions", async () => {
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
    const adapter = new RewritingAdapter(PLAN, (prompt) => (prompt.startsWith("Use at most 10 words.") ? "A short summary here." : "This summary runs on far longer than five words allow."));
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "minimax/MiniMax-M3", judge: true, rewrite: true },
      { env: { TYPESAFE_API_KEY: "k" }, signal: new AbortController().signal, emit: () => {}, adapter, fetch: fakeFetch },
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
