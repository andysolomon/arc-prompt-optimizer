import "server-only";
import {
  DEFAULT_RANKING_OBJECTIVE,
  PREVIEW_SUITE,
  aggregateCases,
  buildPreviewCandidates,
  evaluateSuite,
  rankCandidates,
} from "@/lib/arc-core/core/index.js";
import type {
  CandidateEvaluation,
  CaseEvaluation,
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  PromptCandidate,
} from "@/lib/arc-core/core/index.js";
import { AiSdkCompletionAdapter, MockCompletionAdapter } from "@/lib/adapter";
import { mockProvidersEnabled, type ServerEnv } from "@/lib/env";
import { judgeWithJev, type JevEntry } from "@/lib/jev";
import {
  JUDGE_RANKING_OBJECTIVE,
  type JudgeReport,
  type OptimizeRequest,
  type OptimizeResult,
  type StepEvent,
} from "@/lib/types";

export const COMPLETION_TIMEOUT_MS = 60_000;

/**
 * Records each candidate's output in run order. `evaluateSuite` evaluates candidates sequentially, so the
 * n-th completion belongs to the n-th candidate; the prompt text is checked as a guard.
 */
class RecordingAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;
  readonly #candidates: readonly PromptCandidate[];
  readonly #onComplete: (candidate: PromptCandidate, output: string) => void;
  #index = 0;

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
    const byText = this.#candidates.find((candidate) => candidate.prompt.text === request.prompt);
    const candidate = byText ?? this.#candidates[this.#index];
    this.#index += 1;
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
 * render → run ×4 → (judge) → rank. Emits one step event as each step completes. Prompts and outputs are
 * held in memory for the duration of the request only and are never logged or persisted.
 */
export async function runOptimization(request: OptimizeRequest, options: RunOptions): Promise<OptimizeResult> {
  const candidates = buildPreviewCandidates(request.prompt);
  options.emit({ step: "render", candidateIds: candidates.map((candidate) => candidate.id) });

  const outputs = new Map<string, string>();
  const adapter = new RecordingAdapter(selectAdapter(request, options), candidates, (candidate, output) => {
    outputs.set(candidate.id, output);
    options.emit({ step: `run:${candidate.id}` });
  });

  const evaluation = await evaluateSuite(adapter, candidates, PREVIEW_SUITE, {
    model: request.model,
    timeoutMs: COMPLETION_TIMEOUT_MS,
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
    completionsUsed: evaluation.completionsUsed,
    model: request.model,
  };
}
