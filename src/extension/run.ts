import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_RANKING_OBJECTIVE,
  PREVIEW_CANDIDATE_COUNT,
  PREVIEW_SUITE,
  buildPreviewCandidates,
  createPiCompletionAdapter,
  createPiCompletionClientFromRegistry,
  evaluateSuite,
  rankCandidates,
  rewritePrompt,
} from "../core/index.js";
import type {
  CandidateEvaluation,
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  PromptCandidate,
  RankedCandidate,
} from "../core/index.js";

export { PREVIEW_CANDIDATE_COUNT, PREVIEW_SUITE, baselineCandidate, buildPreviewCandidates } from "../core/preview.js";

export const PREVIEW_COMPLETION_TIMEOUT_MS = 60_000;
/** The rewrite reply carries analysis and a full prompt, so it gets twice the per-candidate budget. */
export const REWRITE_COMPLETION_TIMEOUT_MS = 120_000;
/** Completions without the rewrite: the baseline and three pattern variants, once per preview case. */
export const PREVIEW_COMPLETION_COUNT = PREVIEW_CANDIDATE_COUNT * PREVIEW_SUITE.cases.length;
/** Completions with the rewrite: one to rewrite the prompt, then the rewritten candidate joins the preview set. */
export const REWRITE_PREVIEW_COMPLETION_COUNT = 1 + (PREVIEW_CANDIDATE_COUNT + 1) * PREVIEW_SUITE.cases.length;

/** How the rewrite step ended; `not_requested` when `rewrite: false`. */
export type PreviewRewriteReport =
  | { readonly status: "not_requested" }
  | { readonly status: "rewritten"; readonly candidateId: string; readonly analysis: readonly string[]; readonly changes: readonly string[] }
  | { readonly status: "failed"; readonly reason: string };

export interface PreviewRunOptions {
  readonly prompt: string;
  /** Canonical `provider/id` reference. */
  readonly model: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Ask the model to rewrite the prompt first and rank the rewrite as an extra candidate. Defaults to true. */
  readonly rewrite?: boolean;
  /** Registry used to build the Pi completion adapter. */
  readonly modelRegistry?: ModelRegistry;
  /** Injected adapter; takes precedence over `modelRegistry`. */
  readonly adapter?: CompletionAdapter;
}

export interface PreviewRunResult {
  readonly baselineCandidateId: string;
  readonly candidates: readonly PromptCandidate[];
  readonly evaluations: readonly CandidateEvaluation[];
  readonly ranking: readonly RankedCandidate[];
  readonly rewrite: PreviewRewriteReport;
  readonly completionsUsed: number;
}

/** Live adapters take no offline fixture selector. */
class LivePreviewAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;

  constructor(inner: CompletionAdapter) {
    this.#inner = inner;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const { fixtureId: _fixtureId, ...liveRequest } = request;
    return await this.#inner.complete(liveRequest, signal);
  }
}

function previewAdapter(options: PreviewRunOptions): CompletionAdapter {
  if (options.adapter !== undefined) return new LivePreviewAdapter(options.adapter);
  if (options.modelRegistry === undefined) {
    throw new TypeError("Preview run requires a model registry or a completion adapter.");
  }
  const client = createPiCompletionClientFromRegistry(options.modelRegistry);
  return new LivePreviewAdapter(createPiCompletionAdapter({ client, defaultModel: options.model }));
}

/**
 * Rewrites the prompt with one completion (unless `rewrite: false`), then evaluates the baseline, the rewrite
 * when it parsed, and the three pattern variants sequentially, and ranks them. A failed or unparseable rewrite
 * is reported in `rewrite` and the run continues without it; cancellation stops the run.
 */
export async function runPreview(options: PreviewRunOptions): Promise<PreviewRunResult> {
  const preview = buildPreviewCandidates(options.prompt);
  const adapter = previewAdapter(options);
  let candidates = preview;
  let rewrite: PreviewRewriteReport = Object.freeze({ status: "not_requested" });
  let rewriteCompletions = 0;
  if (options.rewrite ?? true) {
    const outcome = await rewritePrompt(adapter, options.prompt, {
      model: options.model,
      timeoutMs: REWRITE_COMPLETION_TIMEOUT_MS,
      // One attempt only, so the preview never exceeds the completion count the confirmation promised.
      maxAttempts: 1,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    rewriteCompletions = outcome.attempts;
    if (outcome.status === "rewritten") {
      candidates = Object.freeze([preview[0]!, outcome.candidate, ...preview.slice(1)]);
      rewrite = Object.freeze({ status: "rewritten", candidateId: outcome.candidate.id, analysis: outcome.analysis, changes: outcome.changes });
    } else {
      rewrite = Object.freeze({ status: "failed", reason: outcome.reason });
    }
  }
  const evaluation = await evaluateSuite(adapter, candidates, PREVIEW_SUITE, {
    model: options.model,
    timeoutMs: options.timeoutMs ?? PREVIEW_COMPLETION_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return Object.freeze({
    baselineCandidateId: candidates[0]!.id,
    candidates,
    evaluations: evaluation.candidates,
    ranking: rankCandidates(evaluation.candidates, DEFAULT_RANKING_OBJECTIVE),
    rewrite,
    completionsUsed: evaluation.completionsUsed + rewriteCompletions,
  });
}
