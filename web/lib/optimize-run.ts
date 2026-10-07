import "server-only";
import {
  DEFAULT_RANKING_OBJECTIVE,
  PREVIEW_SUITE,
  aggregateCases,
  evaluateCandidate,
  rankCandidates,
  rewritePrompt,
} from "@/lib/arc-core/core/index.js";
import type {
  CandidateEvaluation,
  CaseEvaluation,
  EvaluateOptions,
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  PromptCandidate,
} from "@/lib/arc-core/core/index.js";
import { AiSdkCompletionAdapter, MockCompletionAdapter } from "@/lib/adapter";
import { mockProvidersEnabled, type ServerEnv } from "@/lib/env";
import { candidateLabel } from "@/lib/format";
import { buildPatternCandidates } from "@/lib/pattern-candidates";
import { getModel } from "@/lib/models";
import { judgeWithJev, type JevEntry } from "@/lib/jev";
import {
  JUDGE_RANKING_OBJECTIVE,
  type JudgeReport,
  type OptimizeRequest,
  type RewriteReport,
  type OptimizeResult,
  type StepEvent,
} from "@/lib/types";

export const COMPLETION_TIMEOUT_MS = 60_000;
/**
 * Reasoning-heavy gateways (MiniMax, OpenCode Go) regularly need more than a minute for one long answer, and the
 * rewrite reply (analysis, full prompt, change list) is the longest completion in a run.
 */
export const SLOW_COMPLETION_TIMEOUT_MS = 120_000;
export const REWRITE_TIMEOUT_MS = 120_000;

/** Per-completion timeout. Worst case per run: rewrite + one parallel round of candidates + judge ≤ 300 s. */
export function completionTimeoutMs(model: OptimizeRequest["model"]): number {
  const provider = getModel(model).provider;
  return provider === "minimax" || provider === "opencode-go" ? SLOW_COMPLETION_TIMEOUT_MS : COMPLETION_TIMEOUT_MS;
}

/**
 * Evaluates every candidate concurrently with the core's evaluateCandidate (the same per-candidate path
 * evaluateSuite takes sequentially), so a run waits for the slowest completion rather than the sum of all of
 * them. The first failure aborts the remaining completions and names the candidate that failed.
 */
async function evaluateConcurrently(
  adapter: CompletionAdapter,
  candidates: readonly PromptCandidate[],
  options: Required<Pick<EvaluateOptions, "model" | "timeoutMs" | "signal">>,
): Promise<{ candidates: readonly CandidateEvaluation[]; completionsUsed: number }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal.aborted) controller.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const evaluations = await Promise.all(
      candidates.map((candidate) =>
        evaluateCandidate(adapter, candidate, PREVIEW_SUITE, { ...options, signal: controller.signal }).catch((error: unknown) => {
          const first = !controller.signal.aborted;
          controller.abort();
          if (!first || options.signal.aborted) throw error;
          const label = candidateLabel(candidate.metadata?.label, candidate.prompt.pattern).toLowerCase();
          throw new Error(`The ${label} candidate failed: ${error instanceof Error ? error.message : String(error)}`);
        }),
      ),
    );
    return { candidates: evaluations, completionsUsed: candidates.length * PREVIEW_SUITE.cases.length };
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Records each candidate's output. Completions run concurrently, so the candidate is identified by its prompt
 * text (the preview suite has no case input, so the completion prompt is exactly the candidate text).
 */
class RecordingAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;
  readonly #candidates: readonly PromptCandidate[];
  readonly #onComplete: (candidate: PromptCandidate, output: string) => void;

  constructor(
    inner: CompletionAdapter,
    candidates: readonly PromptCandidate[],
    onComplete: (candidate: PromptCandidate, output: string) => void,
  ) {
    this.#inner = inner;
    this.#candidates = candidates;
    this.#onComplete = onComplete;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    // Live adapters take no offline fixture selector.
    const liveRequest: CompletionRequest = {
      prompt: request.prompt,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.maxOutputCharacters === undefined ? {} : { maxOutputCharacters: request.maxOutputCharacters }),
    };
    const result = await this.#inner.complete(liveRequest, signal);
    const candidate = this.#candidates.find((entry) => entry.prompt.text === request.prompt);
    if (candidate !== undefined) this.#onComplete(candidate, result.text);
    return result;
  }
}

function withJudgeScores(
  evaluations: readonly CandidateEvaluation[],
  judge: Extract<JudgeReport, { status: "judged" }>,
): readonly CandidateEvaluation[] {
  return evaluations.map((evaluation) => {
    const answer = judge.answers[evaluation.candidateId];
    if (answer === undefined) return evaluation;
    const cases: CaseEvaluation[] = evaluation.cases.map((entry) => ({
      ...entry,
      judge: {
        status: "judged",
        score: answer.normalized,
        rationale: `TypeSafe ${judge.model} Score ${answer.score.toFixed(2)} of ${Object.keys(answer.legend).length - 1}, confidence ${answer.confidence.toFixed(2)}.`,
      },
    }));
    return { candidateId: evaluation.candidateId, cases, aggregate: aggregateCases(cases) };
  });
}

export interface RunOptions {
  readonly env: ServerEnv;
  readonly signal: AbortSignal;
  readonly emit: (event: StepEvent) => void;
  /** Test seam. */
  readonly adapter?: CompletionAdapter;
  readonly fetch?: typeof fetch;
}

function selectAdapter(request: OptimizeRequest, options: RunOptions): CompletionAdapter {
  if (options.adapter !== undefined) return options.adapter;
  if (mockProvidersEnabled(options.env)) return new MockCompletionAdapter(request.model);
  return new AiSdkCompletionAdapter(request.model, options.env);
}

function mockJudge(entries: readonly JevEntry[]): JudgeReport {
  const legend = { "0": "Off-task or empty", "1": "Addresses the task but incomplete or vague", "2": "Complete and accurate, some loose ends", "3": "Complete, accurate, and clearly organized" };
  const answers = Object.fromEntries(
    entries.map((entry, index) => {
      const peak = index === 0 ? 1 : 3 - (index % 2);
      const probabilities: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0 };
      probabilities[String(peak)] = 0.8;
      probabilities[String(peak === 3 ? 2 : peak + 1)] = 0.2;
      const score = Object.entries(probabilities).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
      return [entry.candidateId, { score, confidence: 0.8, probabilities, legend, normalized: score / 3 }];
    }),
  );
  return { status: "judged", model: "jev-mock", answers };
}

/**
 * (rewrite) → render → run every candidate concurrently → (judge) → rank. Emits one step event as each step completes. Prompts and
 * outputs are held in memory for the duration of the request only and are never logged or persisted.
 */
export async function runOptimization(request: OptimizeRequest, options: RunOptions): Promise<OptimizeResult> {
  const modelAdapter = selectAdapter(request, options);
  const preview = buildPatternCandidates(request.prompt);

  let rewrite: RewriteReport = { status: "not_requested" };
  let rewriteCompletions = 0;
  let candidates: readonly PromptCandidate[] = preview;
  if (request.rewrite) {
    // Cancellation propagates from rewritePrompt and stops the run; other failures leave the baseline and all patterns.
    const outcome = await rewritePrompt(modelAdapter, request.prompt, {
      model: request.model,
      timeoutMs: REWRITE_TIMEOUT_MS,
      signal: options.signal,
    });
    rewriteCompletions = 1;
    if (outcome.status === "rewritten") {
      candidates = [preview[0]!, outcome.candidate, ...preview.slice(1)];
      rewrite = {
        status: "rewritten",
        candidateId: outcome.candidate.id,
        analysis: [...outcome.analysis],
        changes: [...outcome.changes],
        measurements: outcome.measurements,
      };
    } else {
      rewrite = { status: "failed", reason: outcome.reason };
    }
    options.emit({ step: "rewrite", status: rewrite.status === "rewritten" ? "rewritten" : "failed" });
  }

  options.emit({
    step: "render",
    candidateIds: candidates.map((candidate) => candidate.id),
    candidateLabels: candidates.map((candidate) => candidateLabel(candidate.metadata?.label, candidate.prompt.pattern)),
  });

  const outputs = new Map<string, string>();
  const adapter = new RecordingAdapter(modelAdapter, candidates, (candidate, output) => {
    outputs.set(candidate.id, output);
    options.emit({ step: `run:${candidate.id}` });
  });

  const evaluation = await evaluateConcurrently(adapter, candidates, {
    model: request.model,
    timeoutMs: completionTimeoutMs(request.model),
    signal: options.signal,
  });

  let judge: JudgeReport = { status: "not_requested" };
  let evaluations = evaluation.candidates;
  if (request.judge) {
    const entries: JevEntry[] = candidates.map((candidate) => ({
      candidateId: candidate.id,
      prompt: candidate.prompt.text,
      output: outputs.get(candidate.id) ?? "",
    }));
    if (mockProvidersEnabled(options.env)) {
      judge = mockJudge(entries);
    } else if (options.env.TYPESAFE_API_KEY === undefined) {
      judge = { status: "failed", reason: "TYPESAFE_API_KEY is not configured." };
    } else {
      judge = await judgeWithJev(entries, {
        apiKey: options.env.TYPESAFE_API_KEY,
        signal: options.signal,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
    }
    if (judge.status === "judged") evaluations = withJudgeScores(evaluations, judge);
    options.emit({ step: "judge" });
  }

  const ranking = rankCandidates(evaluations, judge.status === "judged" ? JUDGE_RANKING_OBJECTIVE : DEFAULT_RANKING_OBJECTIVE);
  options.emit({ step: "rank" });

  return {
    baselineCandidateId: candidates[0]!.id,
    candidates,
    evaluations,
    ranking,
    judge,
    rewrite,
    completionsUsed: evaluation.completionsUsed + rewriteCompletions,
    model: request.model,
  };
}
