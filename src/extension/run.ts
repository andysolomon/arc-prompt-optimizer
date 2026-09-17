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
export const PREVIEW_COMPLETION_COUNT = PREVIEW_CANDIDATE_COUNT * PREVIEW_SUITE.cases.length;

export interface PreviewRunOptions {
  readonly prompt: string;
  /** Canonical `provider/id` reference. */
  readonly model: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
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

/** Evaluates the four preview candidates sequentially (4 completions) and ranks them. */
export async function runPreview(options: PreviewRunOptions): Promise<PreviewRunResult> {
  const candidates = buildPreviewCandidates(options.prompt);
  const adapter = previewAdapter(options);
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
    completionsUsed: evaluation.completionsUsed,
  });
}
