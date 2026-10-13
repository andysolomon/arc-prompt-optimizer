import "server-only";
import {
  DEFAULT_RANKING_OBJECTIVE,
  DEFAULT_REFINE_TEMPERATURE,
  PREVIEW_SUITE,
  aggregateCases,
  evaluateCandidate,
  planHasCriteria,
  planSuite,
  rankCandidates,
  refinePrompt,
  revisePrompt,
  rewritePrompt,
} from "@/lib/arc-core/core/index.js";
import type {
  CandidateEvaluation,
  CaseEvaluation,
  EvaluateOptions,
  EvaluationSuite,
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  PromptCandidate,
  SemanticJudgeAdapter,
  RewritePlan,
  WeightedCriterionCheck,
} from "@/lib/arc-core/core/index.js";
import { AiSdkCompletionAdapter, MockCompletionAdapter } from "@/lib/adapter";
import { mockProvidersEnabled, type ServerEnv } from "@/lib/env";
import { candidateLabel } from "@/lib/format";
import { buildPatternCandidates } from "@/lib/pattern-candidates";
import { getModel } from "@/lib/models";
import { judgeWithJev, type JevEntry } from "@/lib/jev";
import { JEV_RUBRIC, JevJudgeAdapter, MockJevJudgeAdapter } from "@/lib/jev-judge";
import {
  JUDGE_RANKING_OBJECTIVE,
  MAX_REVISION_ROUNDS,
  type JudgeReport,
  type LoopReport,
  type OptimizeRequest,
  type RefineReport,
  type PlanReport,
  type RewriteReport,
  type RevisionReport,
  type OptimizeResult,
  type StepEvent,
} from "@/lib/types";

export const COMPLETION_TIMEOUT_MS = 60_000;
/**
 * Reasoning-heavy gateways (MiniMax, OpenCode Go) regularly need more than a minute for one long answer, and the
 * rewrite reply (analysis, full prompt, change list, plan) is the longest completion in a run.
 */
export const SLOW_COMPLETION_TIMEOUT_MS = 120_000;
export const REWRITE_TIMEOUT_MS = 120_000;
/** Cap across both rewrite attempts, so a slow first attempt cannot double the time the rewrite step takes. */
export const REWRITE_TOTAL_TIMEOUT_MS = 150_000;
/**
 * Wall-clock budget for one run: the route's 300 s `maxDuration` less the judge call's own timeout. The rewrite and
 * the first round always run, the first round within what remains; each revision round (one revise call, then the
 * revision's run) is attempted only while it fits.
 */
export const RUN_BUDGET_MS = 240_000;
/** A revision round needs at least this long per completion, whatever the previous round measured. */
export const MIN_ROUND_ESTIMATE_MS = 10_000;

/** The run's suite (the plan's checks or the preview case) plus a judge rubric, so the core asks Jev about every candidate the refine loop produces. */
export function refineSuite(suite: EvaluationSuite): EvaluationSuite {
  return Object.freeze({
    id: `${suite.id}-refine`,
    cases: Object.freeze(suite.cases.map((entry) => Object.freeze({ ...entry, judgeRubric: JEV_RUBRIC }))),
  });
}

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
  suite: EvaluationSuite,
  options: Required<Pick<EvaluateOptions, "model" | "timeoutMs" | "signal">>,
): Promise<{ candidates: readonly CandidateEvaluation[]; completionsUsed: number }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (options.signal.aborted) controller.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const evaluations = await Promise.all(
      candidates.map((candidate) =>
        evaluateCandidate(adapter, candidate, suite, { ...options, signal: controller.signal }).catch((error: unknown) => {
          const first = !controller.signal.aborted;
          controller.abort();
          if (!first || options.signal.aborted) throw error;
          const label = candidateLabel(candidate.metadata?.label, candidate.prompt.pattern).toLowerCase();
          throw new Error(`The ${label} candidate failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }),
      ),
    );
    return { candidates: evaluations, completionsUsed: candidates.length * suite.cases.length };
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Records each candidate's output. Completions run concurrently, so the candidate is identified by its prompt
 * text (neither suite has a case input, so the completion prompt is exactly the candidate text).
 */
/** Live adapters take no offline fixture selector; evaluations carry one from the suite. */
function liveRequest(request: CompletionRequest): CompletionRequest {
  return {
    prompt: request.prompt,
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.maxOutputCharacters === undefined ? {} : { maxOutputCharacters: request.maxOutputCharacters }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  };
}

class LiveAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;

  constructor(inner: CompletionAdapter) {
    this.#inner = inner;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    return await this.#inner.complete(liveRequest(request), signal);
  }
}

class RecordingAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;
  #candidates: readonly PromptCandidate[];
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

  track(candidates: readonly PromptCandidate[]): void {
    this.#candidates = [...this.#candidates, ...candidates];
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const result = await this.#inner.complete(liveRequest(request), signal);
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
  /** Test seam: wall-clock budget for the run; defaults to {@link RUN_BUDGET_MS}. */
  readonly budgetMs?: number;
  /** Test seam: clock in milliseconds. */
  readonly now?: () => number;
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

/** The deterministic checks of a candidate's single case, or none when it has not been evaluated. */
function checksOf(evaluations: readonly CandidateEvaluation[], candidateId: string): readonly WeightedCriterionCheck[] {
  return evaluations.find((entry) => entry.candidateId === candidateId)?.cases[0]?.deterministic.checks ?? [];
}

/** Longest measured completion latency in a set of evaluations, or `fallback` when none was measured. */
function slowestLatencyMs(evaluations: readonly CandidateEvaluation[], fallback: number): number {
  let slowest = 0;
  for (const evaluation of evaluations) {
    for (const entry of evaluation.cases) if (entry.measurements.latencyMs.status === "measured") slowest = Math.max(slowest, entry.measurements.latencyMs.value);
  }
  return slowest > 0 ? slowest : fallback;
}

function planReport(plan: RewritePlan | undefined, suite: EvaluationSuite, candidates: readonly PromptCandidate[], rewrite: RewriteReport): PlanReport {
  const patterns = candidates.filter((candidate) => candidate.origin === "rendered").map((candidate) => candidate.prompt.pattern);
  if (plan !== undefined && planHasCriteria(plan)) {
    return {
      status: "planned",
      taskType: plan.taskType,
      ...(plan.temperature === undefined ? {} : { temperature: plan.temperature }),
      criteria: { ...plan.criteria, requiredKeywords: [...plan.criteria.requiredKeywords], forbiddenPhrases: [...plan.criteria.forbiddenPhrases] },
      suiteId: suite.id,
      patterns,
    };
  }
  const reason =
    rewrite.status === "failed"
      ? "The rewrite failed, so no task criteria were planned."
      : rewrite.status === "not_requested"
        ? "The rewrite was not requested, so no task criteria were planned."
        : plan === undefined
          ? "The rewrite reply carried no readable plan."
          : "The plan named no objective criteria for this task.";
  return { status: "default", reason, suiteId: suite.id, patterns };
}

/**
 * (rewrite + plan) → render → run every candidate concurrently → score → (revise the rewrite for the checks it
 * failed and run the revision, up to MAX_REVISION_ROUNDS times while the time budget allows) → (judge) → (refine
 * the judged winner) → rank. Emits one step event as each step completes. Prompts and outputs are held in memory
 * for the duration of the request only and are never logged or persisted.
 */
export async function runOptimization(request: OptimizeRequest, options: RunOptions): Promise<OptimizeResult> {
  const now = options.now ?? (() => performance.now());
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const started = now();
  const timeoutMs = completionTimeoutMs(request.model);
  const modelAdapter = selectAdapter(request, options);

  let rewrite: RewriteReport = { status: "not_requested" };
  let plan: RewritePlan | undefined;
  let rewriteCandidate: PromptCandidate | undefined;
  let completionsUsed = 0;
  if (request.rewrite) {
    // Cancellation propagates from rewritePrompt and stops the run; other failures leave the baseline and the patterns.
    const outcome = await rewritePrompt(modelAdapter, request.prompt, {
      model: request.model,
      timeoutMs: REWRITE_TIMEOUT_MS,
      totalTimeoutMs: Math.min(REWRITE_TOTAL_TIMEOUT_MS, budgetMs),
      signal: options.signal,
      ...(request.context === undefined ? {} : { context: request.context }),
      ...(request.useCase === undefined ? {} : { useCase: request.useCase }),
    });
    completionsUsed += outcome.attempts;
    if (outcome.status === "rewritten") {
      rewriteCandidate = outcome.candidate;
      plan = outcome.plan;
      rewrite = {
        status: "rewritten",
        candidateId: outcome.candidate.id,
        analysis: [...outcome.analysis],
        changes: [...outcome.changes],
        measurements: outcome.measurements,
        attempts: outcome.attempts,
      };
    } else {
      rewrite = { status: "failed", reason: outcome.reason, attempts: outcome.attempts };
    }
    options.emit({ step: "rewrite", status: rewrite.status === "rewritten" ? "rewritten" : "failed" });
  }

  const suite = planSuite(plan) ?? PREVIEW_SUITE;
  const preview = buildPatternCandidates(request.prompt, plan);
  let candidates: readonly PromptCandidate[] = rewriteCandidate === undefined ? preview : [preview[0]!, rewriteCandidate, ...preview.slice(1)];

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

  const firstRoundTimeoutMs = Math.max(MIN_ROUND_ESTIMATE_MS, Math.min(timeoutMs, Math.floor(budgetMs - (now() - started))));
  const firstRound = await evaluateConcurrently(adapter, candidates, suite, { model: request.model, timeoutMs: firstRoundTimeoutMs, signal: options.signal });
  completionsUsed += firstRound.completionsUsed;
  let evaluations: readonly CandidateEvaluation[] = firstRound.candidates;
  let lastRoundLatencyMs = slowestLatencyMs(firstRound.candidates, timeoutMs);

  // The lesson's loop: score, find the checks the rewrite failed, revise it for them, run the revision, repeat.
  const revisions: RevisionReport[] = [];
  let loop: LoopReport = { rounds: 0, stoppedBecause: "not_requested" };
  if (!request.rewrite) {
    loop = { rounds: 0, stoppedBecause: "not_requested" };
  } else if (rewriteCandidate === undefined) {
    loop = { rounds: 0, stoppedBecause: "rewrite_failed" };
  } else if (!planHasCriteria(plan)) {
    loop = { rounds: 0, stoppedBecause: "no_criteria" };
  } else {
    let lineage = rewriteCandidate;
    let stoppedBecause: LoopReport["stoppedBecause"] = "max_rounds";
    for (let round = 2; round <= MAX_REVISION_ROUNDS + 1; round += 1) {
      const checks = checksOf(evaluations, lineage.id);
      const failed = checks.filter((check) => !check.passed);
      if (failed.length === 0) {
        stoppedBecause = "all_checks_passed";
        break;
      }
      const remainingMs = budgetMs - (now() - started);
      const estimateMs = Math.min(timeoutMs, Math.max(MIN_ROUND_ESTIMATE_MS, 2 * lastRoundLatencyMs));
      if (remainingMs < 2 * estimateMs) {
        stoppedBecause = "time_budget";
        break;
      }
      const roundTimeoutMs = Math.min(timeoutMs, Math.floor(remainingMs / 2));
      const targeted = failed.map((check) => check.id);
      const outcome = await revisePrompt(
        modelAdapter,
        { draft: request.prompt, candidate: lineage, round, output: outputs.get(lineage.id) ?? "", checks },
        { model: request.model, timeoutMs: roundTimeoutMs, signal: options.signal },
      );
      completionsUsed += outcome.attempts;
      if (outcome.status !== "rewritten") {
        revisions.push({ status: "failed", round, parentCandidateId: lineage.id, targeted, reason: outcome.reason, attempts: outcome.attempts });
        options.emit({ step: "revise", status: "failed", round });
        stoppedBecause = "revision_failed";
        break;
      }
      const revision = outcome.candidate;
      adapter.track([revision]);
      options.emit({ step: "revise", status: "revised", round, candidateId: revision.id, candidateLabel: candidateLabel(revision.metadata?.label, revision.prompt.pattern) });
      const roundStarted = now();
      const run = await evaluateConcurrently(adapter, [revision], suite, { model: request.model, timeoutMs: roundTimeoutMs, signal: options.signal });
      completionsUsed += run.completionsUsed;
      lastRoundLatencyMs = Math.max(slowestLatencyMs(run.candidates, now() - roundStarted), 1);
      candidates = [...candidates, revision];
      evaluations = [...evaluations, ...run.candidates];
      revisions.push({
        status: "revised",
        round,
        candidateId: revision.id,
        parentCandidateId: lineage.id,
        targeted,
        analysis: [...outcome.analysis],
        changes: [...outcome.changes],
        measurements: outcome.measurements,
        attempts: outcome.attempts,
      });
      lineage = revision;
      if (round === MAX_REVISION_ROUNDS + 1) stoppedBecause = checksOf(evaluations, revision.id).every((check) => check.passed) ? "all_checks_passed" : "max_rounds";
    }
    loop = { rounds: revisions.filter((revision) => revision.status === "revised").length, stoppedBecause };
  }

  let judge: JudgeReport = { status: "not_requested" };
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

  let refine: RefineReport = { status: "not_requested" };
  let refineCompletions = 0;
  if (request.refine !== undefined) {
    if (judge.status !== "judged") {
      refine = { status: "failed", reason: "Refine needs Jev scores to iterate on, and the judge did not run." };
    } else {
      // Iterate on whichever candidate Jev ranked first; the refine loop sees its output and verdict as evidence.
      const firstPass = rankCandidates(evaluations, JUDGE_RANKING_OBJECTIVE);
      const startId = firstPass[0]!.candidateId;
      const start = candidates.find((candidate) => candidate.id === startId)!;
      const startEvaluation = evaluations.find((entry) => entry.candidateId === startId)!;
      const refineJudge: JevJudgeAdapter | MockJevJudgeAdapter & SemanticJudgeAdapter = mockProvidersEnabled(options.env)
        ? new MockJevJudgeAdapter()
        : new JevJudgeAdapter({
            apiKey: options.env.TYPESAFE_API_KEY!,
            signal: options.signal,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          });
      try {
        const outcome = await refinePrompt({
          adapter: new LiveAdapter(modelAdapter),
          start,
          suite: refineSuite(suite),
          startEvaluation: { evaluation: startEvaluation, outputs: { [suite.cases[0]!.id]: outputs.get(startId) ?? "" } },
          rounds: request.refine.rounds,
          variantsPerRound: request.refine.variants,
          temperature: DEFAULT_REFINE_TEMPERATURE,
          judge: refineJudge,
          objective: JUDGE_RANKING_OBJECTIVE,
          model: request.model,
          timeoutMs: completionTimeoutMs(request.model),
          signal: options.signal,
          onRound: (round) => options.emit({ step: `refine:${round.round}`, improved: round.improved }),
        });
        candidates = [...candidates, ...outcome.candidates.slice(1)];
        evaluations = [...evaluations, ...outcome.evaluations.slice(1)];
        judge = { ...judge, answers: { ...judge.answers, ...refineJudge.answers } };
        refine = {
          status: "refined",
          startCandidateId: outcome.startCandidateId,
          bestCandidateId: outcome.bestCandidateId,
          rounds: outcome.rounds.map((round) => ({
            ...round,
            attempts: round.attempts.map((attempt) =>
              attempt.status === "evaluated" ? { ...attempt, analysis: [...attempt.analysis], changes: [...attempt.changes] } : { ...attempt },
            ),
          })),
          stopReason: outcome.stopReason,
        };
        refineCompletions = outcome.completionsUsed;
      } catch (error) {
        if (options.signal.aborted) throw error;
        refine = { status: "failed", reason: error instanceof Error ? error.message : "Refine failed." };
      }
    }
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
    plan: planReport(plan, suite, candidates, rewrite),
    revisions,
    loop,
    refine,
    completionsUsed: completionsUsed + refineCompletions,
    model: request.model,
  };
}
