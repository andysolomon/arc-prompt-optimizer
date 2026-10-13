import { z } from "zod";
import { DEFAULT_REWRITE_ATTEMPTS, MAX_PLAN_PATTERNS, MAX_REWRITE_INPUT_CHARACTERS, TASK_TYPES } from "@/lib/arc-core/core/index.js";
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
/** Largest optional task context or target use case sent to the rewrite; matches the core's limit. */
export const MAX_REWRITE_DETAIL_CHARACTERS = MAX_REWRITE_INPUT_CHARACTERS;

/** Optional free text for the rewrite; blank values are dropped so the meta-prompt omits the section. */
function rewriteDetail(label: string) {
  return z
    .string({ error: `${label} must be a string.` })
    .max(MAX_REWRITE_DETAIL_CHARACTERS, { error: `${label} must be at most ${MAX_REWRITE_DETAIL_CHARACTERS.toLocaleString("en-US")} characters.` })
    .transform((value) => (value.trim().length === 0 ? undefined : value.trim()))
    .optional();
}

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

/** Image types a prompt can carry; every vision provider in `lib/models.ts` accepts all four. */
export const IMAGE_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageAttachmentType = (typeof IMAGE_ATTACHMENT_TYPES)[number];
export const MAX_ATTACHMENTS = 3;
/** Per image after the browser downscales it; the request body must stay under Vercel's 4.5 MB limit as base64. */
export const MAX_ATTACHMENT_BYTES = 1_500_000;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 3_000_000;
export const MAX_ATTACHMENT_NAME_CHARACTERS = 200;

/** Decoded size of a base64 string without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export const imageAttachmentSchema = z.object({
  name: z.string({ error: "Attachment name must be a string." }).max(MAX_ATTACHMENT_NAME_CHARACTERS, { error: `Attachment name must be at most ${MAX_ATTACHMENT_NAME_CHARACTERS} characters.` }),
  type: z.enum(IMAGE_ATTACHMENT_TYPES, { error: "Attachments must be JPEG, PNG, WebP, or GIF images." }),
  /** Base64 without a data-URL prefix. */
  data: z
    .string({ error: "Attachment data must be a string." })
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u, { error: "Attachment data must be base64." })
    .refine((value) => base64Bytes(value) <= MAX_ATTACHMENT_BYTES, { error: `Each image must be at most ${(MAX_ATTACHMENT_BYTES / 1_000_000).toFixed(1)} MB.` }),
});

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

/** What a run record keeps about its attachments: never the image data. */
export interface AttachmentInfo {
  readonly name: string;
  readonly type: ImageAttachmentType;
  readonly bytes: number;
}

export function attachmentInfo(attachments: readonly ImageAttachment[] | undefined): AttachmentInfo[] {
  return (attachments ?? []).map((attachment) => ({ name: attachment.name, type: attachment.type, bytes: base64Bytes(attachment.data) }));
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
  /** Where the prompt runs and what it works on; given to the rewrite only. */
  context: rewriteDetail("context"),
  /** What the output is for and who reads it; given to the rewrite only. */
  useCase: rewriteDetail("useCase"),
  /** Iterate on the top-ranked candidate with Jev feedback. Requires `judge: true` and the server flag. */
  refine: refineSettingsSchema.optional(),
  /** Images attached to every completion in the run. Only accepted for models that take images. */
  attachments: z
    .array(imageAttachmentSchema)
    .max(MAX_ATTACHMENTS, { error: `At most ${MAX_ATTACHMENTS} images can be attached.` })
    .refine((entries) => entries.reduce((sum, entry) => sum + base64Bytes(entry.data), 0) <= MAX_ATTACHMENTS_TOTAL_BYTES, {
      error: `Attached images must total at most ${(MAX_ATTACHMENTS_TOTAL_BYTES / 1_000_000).toFixed(0)} MB.`,
    })
    .optional(),
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
  refine: refineReportSchema,
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
  readonly refine: RefineReport;
  /** Every completion requested from the model, including the rewrite and refine generations. */
  readonly plan: PlanReport;
  readonly revisions: readonly RevisionReport[];
  readonly loop: LoopReport;
  /** Every completion requested from the model, including the rewrite, retries, and revisions. */
  readonly completionsUsed: number;
  readonly model: ModelId;
}

/**
 * Step order of a run: `rewrite`, `render`, one `run:<candidateId>` per candidate, then per revision round a
 * `revise` followed by the revision's `run:<candidateId>`, then `judge`, one `refine:<round>` per refine round when
 * requested, and `rank`.
 */
export type StepName = "rewrite" | "render" | `run:${string}` | "revise" | "judge" | `refine:${number}` | "rank";

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
  /** Sent with each `refine:<round>` step: whether that round produced a better candidate. */
  readonly improved?: boolean;
};

export const modelInfoSchema = z.object({
  id: z.enum(MODEL_IDS),
  label: z.string(),
  provider: z.enum(["anthropic", "openai", "google", "minimax", "opencode-go"]),
  /** The model accepts image attachments. */
  vision: z.boolean().default(false),
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
