import { describe, expect, it } from "vitest";
import { DEFAULT_REFINE_TEMPERATURE, FALLBACK_PATTERNS, REFINE_PROTOCOL, REVISE_PROTOCOL, REWRITE_FORMAT_REMINDER, REWRITE_PROTOCOL, buildRewritePrompt } from "@/lib/arc-core/core/index.js";
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

  it("passes the task context and target use case to the rewrite meta-prompt only", async () => {
    const adapter = new RewritingAdapter();
    await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true, context: "Reports are markdown.", useCase: "Exec email" },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(adapter.prompts[0]).toBe(buildRewritePrompt("Summarize this.", { context: "Reports are markdown.", useCase: "Exec email" }));
    expect(adapter.prompts[0]).toContain("Target use case:\n```\nExec email\n```");
    expect(adapter.prompts.slice(1).some((prompt) => prompt.includes("Exec email"))).toBe(false);
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
    // The first pass is the baseline plus the three task-only patterns; the winner is the last of them (scored 2/3).
    // Round 1's revisions tie it, so round 2 refines the same incumbent.
    expect(result.refine.startCandidateId).toBe(result.candidates[3]!.id);
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
    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.slice(4).every((candidate) => candidate.prompt.pattern === "refine")).toBe(true);
    expect(result.evaluations).toHaveLength(8);
    expect(result.ranking).toHaveLength(8);
    expect(result.ranking[0]!.candidateId).toBe(result.refine.bestCandidateId);
    expect(result.ranking[0]!.quality.combined).toEqual({ status: "measured", value: 1 });
    // Jev answers for the refined candidates join the batch answers so the UI can show them.
    expect(result.judge.status).toBe("judged");
    if (result.judge.status === "judged") expect(Object.keys(result.judge.answers)).toHaveLength(8);
    // One batch call for the first pass, then one single-question call per refined candidate.
    expect(jev.calls).toEqual([4, 1, 1, 1, 1]);
    // 4 first-pass completions + 2 rounds × 2 × (generation + run).
    expect(result.completionsUsed).toBe(12);
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
    expect(result.candidates).toHaveLength(4);
    expect(result.completionsUsed).toBe(4);
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
    // Both revisions join the first-pass candidates (baseline, rewrite, the plan's patterns, any revision).
    expect(result.candidates.filter((candidate) => candidate.prompt.pattern === "refine")).toHaveLength(2);
    expect(result.candidates.length).toBeGreaterThanOrEqual(5);
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
    expect(peak).toBe(4);
  });

  it("keeps the candidates that finished when one fails, reports the failure, and leaves it out of the ranking", async () => {
    const steps: StepEvent[] = [];
    const adapter: CompletionAdapter = {
      async complete(request) {
        if (request.prompt.startsWith("<task>")) throw Object.assign(new Error("Completion timed out after 120000ms."), { name: "CompletionTimeoutError", code: "TIMEOUT" });
        return { text: `out ${request.prompt.length}`, latencyMs: 10 };
      },
    };
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: true, rewrite: false },
      { env: { ARC_MOCK_PROVIDERS: "1" }, signal: new AbortController().signal, emit: (event) => steps.push(event), adapter },
    );
    expect(result.candidates).toHaveLength(4);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ label: "Critique", error: { kind: "timeout", name: "CompletionTimeoutError", message: "Completion timed out after 120000ms." } });
    const failedId = result.failures[0]!.candidateId;
    expect(result.evaluations.map((entry) => entry.candidateId)).not.toContain(failedId);
    expect(result.ranking.map((entry) => entry.candidateId)).not.toContain(failedId);
    expect(result.ranking).toHaveLength(3);
    // The failed completion still counts as requested, the judge only sees the candidates that produced output.
    expect(result.completionsUsed).toBe(4);
    expect(result.judge.status === "judged" ? Object.keys(result.judge.answers) : []).toHaveLength(3);
    expect(steps.find((event) => event.step === `run:${failedId}`)).toEqual({ step: `run:${failedId}`, status: "failed", error: result.failures[0]!.error });
  });

  it("fails the run, naming the first candidate, only when no candidate finished", async () => {
    const adapter: CompletionAdapter = {
      complete: () => Promise.reject(Object.assign(new Error("provider overloaded"), { name: "APICallError", statusCode: 503 })),
    };
    const run = runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    await expect(run).rejects.toThrow("The baseline candidate failed: provider overloaded");
    await expect(run).rejects.toMatchObject({ cause: { statusCode: 503 } });
  });

  it("stops the loop when the rewrite's own run fails, and ranks the rest", async () => {
    const adapter = new RewritingAdapter(PLAN, (prompt) => {
      if (prompt === REWRITTEN) throw Object.assign(new Error("Completion timed out after 60000ms."), { name: "CompletionTimeoutError", code: "TIMEOUT" });
      return "short output";
    });
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(result.rewrite.status).toBe("rewritten");
    expect(result.failures.map((failure) => failure.label)).toEqual(["Rewrite"]);
    expect(result.loop).toEqual({ rounds: 0, stoppedBecause: "candidate_failed" });
    expect(result.revisions).toEqual([]);
    expect(result.ranking).toHaveLength(result.candidates.length - 1);
  });

  it("keeps a revision whose run failed out of the ranking and stops revising", async () => {
    let revisionsRun = 0;
    const adapter = new RewritingAdapter(PLAN, (prompt) => {
      if (prompt.startsWith("Use at most 10 words.")) {
        revisionsRun += 1;
        throw Object.assign(new Error("Provider returned 502"), { name: "APICallError", statusCode: 502 });
      }
      return prompt === REWRITTEN ? "far too many words ".repeat(20) : "short output";
    });
    const result = await runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: true },
      { env: {}, signal: new AbortController().signal, emit: () => {}, adapter },
    );
    expect(revisionsRun).toBe(1);
    expect(result.revisions).toHaveLength(1);
    expect(result.loop).toEqual({ rounds: 1, stoppedBecause: "candidate_failed" });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ label: "Rewrite v2", error: { kind: "provider", statusCode: 502 } });
    expect(result.ranking.map((entry) => entry.candidateId)).not.toContain(result.failures[0]!.candidateId);
  });

  it("still stops at once when the run is cancelled mid-round", async () => {
    const controller = new AbortController();
    const adapter: CompletionAdapter = {
      complete(request, signal) {
        if (request.prompt.startsWith("<task>")) return Promise.resolve({ text: "done", latencyMs: 1 });
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("Completion cancelled."), { name: "CompletionCancelledError", code: "CANCELLED" })));
          setTimeout(() => controller.abort(), 5);
        });
      },
    };
    const run = runOptimization(
      { prompt: "Summarize this.", model: "openai/gpt-5-mini", judge: false, rewrite: false },
      { env: {}, signal: controller.signal, emit: () => {}, adapter },
    );
    await expect(run).rejects.toThrow("Completion cancelled.");
  });
});
