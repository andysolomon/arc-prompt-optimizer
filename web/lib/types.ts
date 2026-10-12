import { z } from "zod";
import { DEFAULT_REWRITE_ATTEMPTS, MAX_PLAN_PATTERNS, TASK_TYPES } from "@/lib/arc-core/core/index.js";
import type {
  CandidateEvaluation,
  PromptCandidate,
  RankedCandidate,
  RankingObjective,
} from "@/lib/arc-core/core/index.js";

export type {
  CandidateEvaluation,
  Measurement,
  PromptCandidate,
  PromptPattern,
  RankedCandidate,
  RankingObjective,
} from "@/lib/arc-core/core/index.js";

/** Canonical `provider/id` references accepted by `/api/optimize`. */
export const MODEL_IDS = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5-mini",
  "google/gemini-2.5-flash",
  "minimax/MiniMax-M3",
  "minimax/MiniMax-M2.7",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/glm-5.3",
  "opencode-go/kimi-k2.6",
  "opencode-go/qwen3.7-plus",
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

export const MAX_PROMPT_CHARACTERS = 16_384;

/** Revision rounds of the lesson's optimization loop after the first rewrite: score, revise the weakest checks, re-run. */
export const MAX_REVISION_ROUNDS = 2;

export interface CountRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Candidates a run can rank: the baseline, the rewrite when requested, up to {@link MAX_PLAN_PATTERNS} pattern
 * variants, and up to {@link MAX_REVISION_ROUNDS} revisions of the rewrite. The minimum is a failed rewrite with
 * the fallback pattern trio.
 */
export function candidateRange(rewrite: boolean): CountRange {
  return { min: 1 + MAX_PLAN_PATTERNS, max: 1 + MAX_PLAN_PATTERNS + (rewrite ? 1 + MAX_REVISION_ROUNDS : 0) };
}

/**
 * Model completions a run can spend: one per candidate, plus the rewrite (one call and at most one retry) and, per
 * revision round, the revise call (same retry) and the revision's own run.
 */
export function completionRange(rewrite: boolean): CountRange {
  const candidates = candidateRange(rewrite);
  if (!rewrite) return { min: candidates.min, max: 1 + MAX_PLAN_PATTERNS };
  // Minimum: the rewrite call fails outright, leaving the baseline and the pattern trio. Maximum: a retried rewrite,
  // its run, the baseline, the patterns, and every revision round with a retried revise call and its run.
  return {
    min: 1 + candidates.min,
    max: DEFAULT_REWRITE_ATTEMPTS + 2 + MAX_PLAN_PATTERNS + MAX_REVISION_ROUNDS * (DEFAULT_REWRITE_ATTEMPTS + 1),
  };
}

export const optimizeRequestSchema = z.object({
  prompt: z
    .string({ error: "Prompt must be a string." })
    .max(MAX_PROMPT_CHARACTERS, {
      error: `Prompt must be at most ${MAX_PROMPT_CHARACTERS.toLocaleString("en-US")} characters.`,
    })
    .refine((value) => value.trim().length > 0, { error: "Prompt must not be empty." }),
  model: z.enum(MODEL_IDS, { error: "Model is not in the allowed list." }),
  judge: z.boolean({ error: "judge must be a boolean." }),
  /** Ask the model to rewrite the prompt first and rank the rewrite as an extra candidate. Defaults to true. */
  rewrite: z.boolean({ error: "rewrite must be a boolean." }).default(true),
});

export type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;
/** Request body as sent by a client; `rewrite` may be omitted. */
export type OptimizeRequestBody = z.input<typeof optimizeRequestSchema>;

export const measurementSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("measured"), value: z.number() }),
  z.object({ status: z.literal("unknown"), reason: z.string() }),
]);

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const promptCandidateSchema = z.object({
  id: z.string(),
  prompt: z.object({
    pattern: z.string(),
    text: z.string(),
    variablesUsed: z.array(z.string()).readonly(),
  }),
  origin: z.enum(["rendered", "fixture", "explicit_generation"]),
  parentCandidateId: z.string().optional(),
  metadata: z.record(z.string(), metadataValueSchema).optional(),
});

export const judgeOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({ status: z.literal("judged"), score: z.number(), rationale: z.string() }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({ status: z.literal("failed"), reason: z.string() }),
  z.object({ status: z.literal("skipped"), reason: z.string() }),
]);

export const caseEvaluationSchema = z.object({
  caseId: z.string(),
  candidateId: z.string(),
  completionFixtureId: z.string(),
  model: z.string().nullable(),
  finishReason: z.string().nullable(),
  outputCharacters: z.number(),
  deterministic: z.object({
    passed: z.boolean(),
    wordCount: z.number(),
    characterCount: z.number(),
    checks: z.array(
      z.object({
        id: z.string(),
        criterion: z.string(),
        weight: z.number(),
        passed: z.boolean(),
        expected: z.union([z.string(), z.number()]),
        actual: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ),
    totalWeight: z.number(),
    passedWeight: z.number(),
    score: z.number().nullable(),
  }),
  judge: judgeOutcomeSchema,
  measurements: z.object({
    latencyMs: measurementSchema,
    inputTokens: measurementSchema,
    outputTokens: measurementSchema,
    totalTokens: measurementSchema,
    costUsd: measurementSchema,
  }),
});

export const candidateEvaluationSchema = z.object({
  candidateId: z.string(),
  cases: z.array(caseEvaluationSchema),
  aggregate: z.object({
    caseCount: z.number(),
    passedCaseCount: z.number(),
    deterministicScore: measurementSchema,
    judgeScore: measurementSchema,
    latencyMs: measurementSchema,
    totalTokens: measurementSchema,
    costUsd: measurementSchema,
  }),
});

export const tieBreakerSchema = z.enum(["totalTokens", "latencyMs", "costUsd"]);

export const rankedCandidateSchema = z.object({
  rank: z.number(),
  candidateId: z.string(),
  quality: z.object({
    combined: measurementSchema,
    deterministic: measurementSchema,
    judge: measurementSchema,
  }),
  operational: z.object({
    latencyMs: measurementSchema,
    totalTokens: measurementSchema,
    costUsd: measurementSchema,
  }),
  tiedWith: z.array(z.string()),
  tieBrokenBy: tieBreakerSchema.nullable(),
});

/** One TypeSafe Score answer, kept raw, plus the 0–1 normalization that feeds the ranking. */
export const jevAnswerSchema = z.object({
  score: z.number(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  legend: z.record(z.string(), z.string()),
  normalized: z.number().min(0).max(1),
});

export type JevAnswer = z.infer<typeof jevAnswerSchema>;

export const judgeReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({
    status: z.literal("judged"),
    model: z.string(),
    answers: z.record(z.string(), jevAnswerSchema),
  }),
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);

export type JudgeReport = z.infer<typeof judgeReportSchema>;

const operationalMeasurementsSchema = z.object({
  latencyMs: measurementSchema,
  inputTokens: measurementSchema,
  outputTokens: measurementSchema,
  totalTokens: measurementSchema,
  costUsd: measurementSchema,
});

export const rewriteReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({
    status: z.literal("rewritten"),
    candidateId: z.string(),
    analysis: z.array(z.string()),
    changes: z.array(z.string()),
    measurements: operationalMeasurementsSchema,
    /** Completions spent, including a retry after an unparseable reply. */
    attempts: z.number(),
  }),
  z.object({ status: z.literal("failed"), reason: z.string(), attempts: z.number() }),
]);

export type RewriteReport = z.infer<typeof rewriteReportSchema>;

export const planCriteriaSchema = z.object({
  expectedFormat: z.enum(["json", "bullet_list", "numbered_list"]).optional(),
  maxWords: z.number().optional(),
  minWords: z.number().optional(),
  requiredKeywords: z.array(z.string()),
  forbiddenPhrases: z.array(z.string()),
});

/**
 * How the run scored its candidates: the plan the rewrite step produced (task type, temperature, objective
 * criteria), or the preview suite's non-empty check when the rewrite produced no usable criteria.
 */
export const planReportSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("planned"),
    taskType: z.enum(TASK_TYPES),
    temperature: z.number().optional(),
    criteria: planCriteriaSchema,
    suiteId: z.string(),
    /** Patterns the plan chose, in candidate order. */
    patterns: z.array(z.string()),
  }),
  z.object({ status: z.literal("default"), reason: z.string(), suiteId: z.string(), patterns: z.array(z.string()) }),
]);

export type PlanReport = z.infer<typeof planReportSchema>;

/** One round of the optimization loop. */
export const revisionReportSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("revised"),
    round: z.number(),
    candidateId: z.string(),
    parentCandidateId: z.string(),
    /** Check ids the parent failed and this revision was asked to fix. */
    targeted: z.array(z.string()),
    analysis: z.array(z.string()),
    changes: z.array(z.string()),
    measurements: operationalMeasurementsSchema,
    attempts: z.number(),
  }),
  z.object({ status: z.literal("failed"), round: z.number(), parentCandidateId: z.string(), targeted: z.array(z.string()), reason: z.string(), attempts: z.number() }),
]);

export type RevisionReport = z.infer<typeof revisionReportSchema>;

/** Why the loop stopped. */
export const loopReportSchema = z.object({
  rounds: z.number(),
  stoppedBecause: z.enum(["rewrite_failed", "no_criteria", "all_checks_passed", "max_rounds", "time_budget", "revision_failed", "not_requested"]),
});

export type LoopReport = z.infer<typeof loopReportSchema>;

export const optimizeResultSchema = z.object({
  baselineCandidateId: z.string(),
  candidates: z.array(promptCandidateSchema),
  evaluations: z.array(candidateEvaluationSchema),
  ranking: z.array(rankedCandidateSchema),
  judge: judgeReportSchema,
  rewrite: rewriteReportSchema,
  plan: planReportSchema,
  revisions: z.array(revisionReportSchema),
  loop: loopReportSchema,
  completionsUsed: z.number(),
  model: z.enum(MODEL_IDS),
});

/**
 * Wire shape of the final `result` event / JSON body. Declared structurally against the core types so
 * a change in the core surfaces as a type error here rather than a silent schema drift.
 */
export interface OptimizeResult {
  readonly baselineCandidateId: string;
  readonly candidates: readonly PromptCandidate[];
  readonly evaluations: readonly CandidateEvaluation[];
  readonly ranking: readonly RankedCandidate[];
  readonly judge: JudgeReport;
  readonly rewrite: RewriteReport;
  readonly plan: PlanReport;
  readonly revisions: readonly RevisionReport[];
  readonly loop: LoopReport;
  /** Every completion requested from the model, including the rewrite, retries, and revisions. */
  readonly completionsUsed: number;
  readonly model: ModelId;
}

/**
 * Step order of a run: `rewrite`, `render`, one `run:<candidateId>` per candidate, then per revision round a
 * `revise` followed by the revision's `run:<candidateId>`, then `judge` and `rank`.
 */
export type StepName = "rewrite" | "render" | `run:${string}` | "revise" | "judge" | "rank";

export type StepEvent = {
  readonly step: StepName;
  /** Candidate ids in run order, sent with the `render` step so the client can label `run:` steps. */
  readonly candidateIds?: readonly string[];
  /** Human labels matching `candidateIds`, sent with the `render` step. */
  readonly candidateLabels?: readonly string[];
  /** Sent with the `rewrite` and `revise` steps. */
  readonly status?: "rewritten" | "revised" | "failed";
  /** Sent with the `revise` step: the loop round (2 for the first revision). */
  readonly round?: number;
  /** Sent with a successful `revise` step: the revision candidate about to run. */
  readonly candidateId?: string;
  readonly candidateLabel?: string;
};

export const modelInfoSchema = z.object({
  id: z.enum(MODEL_IDS),
  label: z.string(),
  provider: z.enum(["anthropic", "openai", "google", "minimax", "opencode-go"]),
});

export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const modelsResponseSchema = z.object({
  models: z.array(modelInfoSchema),
  judgeAvailable: z.boolean(),
});

export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });

export const JUDGE_RANKING_OBJECTIVE: RankingObjective = Object.freeze({
  deterministicWeight: 1,
  judgeWeight: 1,
  tieBreakers: Object.freeze(["totalTokens", "latencyMs", "costUsd"] as const),
});
