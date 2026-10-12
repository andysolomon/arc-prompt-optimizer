import { z } from "zod";
import { OPTIMIZE_PATTERNS } from "@/lib/pattern-candidates";
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

/** One completion per candidate, plus the rewrite generation when requested. */
export function completionCount(rewrite: boolean): number {
  return candidateCount(rewrite) + (rewrite ? 1 : 0);
}

/** Baseline, every catalog pattern, and the rewrite when requested. */
export function candidateCount(rewrite: boolean): number {
  return 1 + OPTIMIZE_PATTERNS.length + (rewrite ? 1 : 0);
}

/** Bounds for the refine loop as offered by the web app; the core allows up to 4 of each. */
export const REFINE_MAX_ROUNDS = 3;
export const REFINE_MAX_VARIANTS = 3;
export const REFINE_DEFAULT_ROUNDS = 2;
export const REFINE_DEFAULT_VARIANTS = 2;

/** Upper bound on extra completions the refine loop may make: one generation plus one run per variant per round. */
export function refineCompletionCount(refine: RefineSettings | undefined): number {
  return refine === undefined ? 0 : refine.rounds * refine.variants * 2;
}

export const refineSettingsSchema = z.object({
  rounds: z.number({ error: "refine.rounds must be a number." }).int().min(1).max(REFINE_MAX_ROUNDS, { error: `refine.rounds must be between 1 and ${REFINE_MAX_ROUNDS}.` }),
  variants: z.number({ error: "refine.variants must be a number." }).int().min(1).max(REFINE_MAX_VARIANTS, { error: `refine.variants must be between 1 and ${REFINE_MAX_VARIANTS}.` }),
});

export type RefineSettings = z.infer<typeof refineSettingsSchema>;

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
  /** Iterate on the top-ranked candidate with Jev feedback. Requires `judge: true` and the server flag. */
  refine: refineSettingsSchema.optional(),
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

export const rewriteReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({
    status: z.literal("rewritten"),
    candidateId: z.string(),
    analysis: z.array(z.string()),
    changes: z.array(z.string()),
    measurements: z.object({
      latencyMs: measurementSchema,
      inputTokens: measurementSchema,
      outputTokens: measurementSchema,
      totalTokens: measurementSchema,
      costUsd: measurementSchema,
    }),
  }),
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);

export type RewriteReport = z.infer<typeof rewriteReportSchema>;

export const refineAttemptSchema = z.discriminatedUnion("status", [
  z.object({
    variantIndex: z.number(),
    status: z.literal("evaluated"),
    candidateId: z.string(),
    analysis: z.array(z.string()),
    changes: z.array(z.string()),
    measurements: z.object({
      latencyMs: measurementSchema,
      inputTokens: measurementSchema,
      outputTokens: measurementSchema,
      totalTokens: measurementSchema,
      costUsd: measurementSchema,
    }),
  }),
  z.object({ variantIndex: z.number(), status: z.literal("duplicate"), candidateId: z.string() }),
  z.object({ variantIndex: z.number(), status: z.literal("invalid"), reason: z.string() }),
  z.object({ variantIndex: z.number(), status: z.literal("failed"), reason: z.string() }),
]);

export const refineRoundSchema = z.object({
  round: z.number(),
  parentCandidateId: z.string(),
  attempts: z.array(refineAttemptSchema),
  bestCandidateId: z.string(),
  improved: z.boolean(),
});

export type RefineRoundReport = z.infer<typeof refineRoundSchema>;

export const refineReportSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({
    status: z.literal("refined"),
    startCandidateId: z.string(),
    bestCandidateId: z.string(),
    rounds: z.array(refineRoundSchema),
    stopReason: z.enum(["rounds_exhausted", "perfect_score", "budget_exhausted"]),
  }),
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);

export type RefineReport = z.infer<typeof refineReportSchema>;

export const optimizeResultSchema = z.object({
  baselineCandidateId: z.string(),
  candidates: z.array(promptCandidateSchema),
  evaluations: z.array(candidateEvaluationSchema),
  ranking: z.array(rankedCandidateSchema),
  judge: judgeReportSchema,
  rewrite: rewriteReportSchema,
  refine: refineReportSchema,
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
  readonly refine: RefineReport;
  /** Every completion requested from the model, including the rewrite and refine generations. */
  readonly completionsUsed: number;
  readonly model: ModelId;
}

/** Fixed step order of a run. `run:<candidateId>` repeats once per candidate; `refine:<round>` once per refine round. */
export type StepName = "rewrite" | "render" | `run:${string}` | "judge" | `refine:${number}` | "rank";

export type StepEvent = {
  readonly step: StepName;
  /** Candidate ids in run order, sent with the `render` step so the client can label `run:` steps. */
  readonly candidateIds?: readonly string[];
  /** Human labels matching `candidateIds`, sent with the `render` step. */
  readonly candidateLabels?: readonly string[];
  /** Sent with the `rewrite` step. */
  readonly status?: "rewritten" | "failed";
  /** Sent with each `refine:<round>` step: whether that round produced a better candidate. */
  readonly improved?: boolean;
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
  /** The server flag is on; the refine loop also needs the judge. */
  refineAvailable: z.boolean().default(false),
});

export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });

export const JUDGE_RANKING_OBJECTIVE: RankingObjective = Object.freeze({
  deterministicWeight: 1,
  judgeWeight: 1,
  tieBreakers: Object.freeze(["totalTokens", "latencyMs", "costUsd"] as const),
});
