export type PatternName =
  | "persona"
  | "few_shot"
  | "chain_of_thought"
  | "template_fill"
  | "critique"
  | "guardrail"
  | "decomposition"
  | "audience_adapt"
  | "boundary";

export interface PromptGenerationGuidance {
  readonly activation: "explicit";
  readonly automatic: false;
  readonly notes: string;
}

export interface PromptPattern<Name extends string = string> {
  readonly name: Name;
  readonly displayName: string;
  readonly description: string;
  readonly template: string;
  readonly variables: readonly string[];
  readonly recommendedTemperature: number;
  readonly generationGuidance?: PromptGenerationGuidance;
}

export interface RenderedPrompt<Name extends string = string> {
  readonly pattern: Name;
  readonly text: string;
  readonly variablesUsed: readonly string[];
}

export interface PromptCandidate {
  readonly id: string;
  readonly prompt: RenderedPrompt;
  readonly origin: "rendered" | "fixture" | "explicit_generation";
  readonly parentCandidateId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type ExpectedFormat = "json" | "bullet_list" | "numbered_list";

export interface DeterministicCriteria {
  readonly expectedFormat?: ExpectedFormat;
  readonly maxWords?: number;
  readonly minWords?: number;
  readonly requiredKeywords?: readonly string[];
  readonly forbiddenPhrases?: readonly string[];
}

export interface EvaluationFixture {
  readonly id: string;
  readonly name: string;
  readonly completionFixtureId: string;
  readonly criteria: DeterministicCriteria;
}

export interface EvaluationSuiteFixture {
  readonly id: string;
  readonly cases: readonly EvaluationFixture[];
}

export interface CriterionCheck {
  readonly criterion: "format" | "max_words" | "min_words" | "required_keyword" | "forbidden_phrase";
  readonly passed: boolean;
  readonly expected: string | number;
  readonly actual: string | number | boolean;
}

export interface FixtureCheckResult {
  readonly passed: boolean;
  readonly wordCount: number;
  readonly checks: readonly CriterionCheck[];
}

export interface CompletionRequest {
  /** Offline-only fixture selector; provider-neutral adapters ignore this hint. */
  readonly fixtureId?: string;
  /** Optional provider/model selector; adapters may reject unavailable models. */
  readonly model?: string;
  readonly prompt: string;
  readonly maxOutputCharacters?: number;
}

export interface CompletionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly model?: string;
  /** Provider-neutral finish reason; adapters may report provider-specific values. */
  readonly finishReason?: string;
  readonly latencyMs?: number;
  readonly usage?: CompletionUsage;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Optional monetary cost. Absent means the measurement is unknown, never zero. */
  readonly costUsd?: number;
}

export interface CompletionAdapter {
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
}

export interface CompletionFixtureDefinition extends CompletionResult {
  readonly id: string;
}

export interface EvaluationResult {
  readonly fixtureId: string;
  readonly checks: FixtureCheckResult;
}

// ---------------------------------------------------------------------------
// Phase 2: deterministic weighted evaluation
// ---------------------------------------------------------------------------

/** Comparison kinds supported by user-defined weighted criteria. No regular expressions are accepted. */
export type CustomCriterionKind = "includes" | "excludes" | "equals" | "starts_with" | "ends_with";

export interface WeightedCriterionDefinition {
  readonly id: string;
  readonly weight: number;
  readonly kind: CustomCriterionKind;
  readonly value: string;
  readonly caseSensitive?: boolean;
}

export interface JsonShapeCriterion {
  readonly rootType?: "object" | "array";
  readonly requiredKeys?: readonly string[];
}

export interface ListShapeCriterion {
  readonly minItems?: number;
  readonly maxItems?: number;
}

export type BuiltinCriterionName =
  | "format"
  | "max_words"
  | "min_words"
  | "required_keyword"
  | "forbidden_phrase"
  | "exact_match"
  | "max_characters"
  | "min_characters"
  | "json_shape"
  | "list_shape";

export type EvaluationCriterionName = BuiltinCriterionName | "custom";

/** Superset of {@link DeterministicCriteria}; every Phase 1 criteria object is a valid EvaluationCriteria. */
export interface EvaluationCriteria extends DeterministicCriteria {
  readonly exactMatch?: string;
  readonly maxCharacters?: number;
  readonly minCharacters?: number;
  readonly jsonShape?: JsonShapeCriterion;
  readonly listShape?: ListShapeCriterion;
  /** Weight overrides for built-in checks; every built-in check defaults to weight 1. */
  readonly weights?: Readonly<Partial<Record<BuiltinCriterionName, number>>>;
  readonly custom?: readonly WeightedCriterionDefinition[];
}

export interface WeightedCriterionCheck {
  readonly id: string;
  readonly criterion: EvaluationCriterionName;
  readonly weight: number;
  readonly passed: boolean;
  readonly expected: string | number;
  readonly actual: string | number | boolean;
}

export interface DeterministicEvaluation {
  readonly passed: boolean;
  readonly wordCount: number;
  readonly characterCount: number;
  readonly checks: readonly WeightedCriterionCheck[];
  readonly totalWeight: number;
  readonly passedWeight: number;
  /** passedWeight / totalWeight in [0, 1]; null when there are no criteria or total weight is 0. */
  readonly score: number | null;
}

export interface EvaluationCase extends EvaluationFixture {
  readonly criteria: EvaluationCriteria;
  readonly input?: string;
  readonly expectedOutput?: string;
  readonly judgeRubric?: string;
}

export interface EvaluationSuite {
  readonly id: string;
  readonly cases: readonly EvaluationCase[];
}

// ---------------------------------------------------------------------------
// Phase 2: measurements, semantic judge, ranking, optimization
// ---------------------------------------------------------------------------

export type Measurement =
  | { readonly status: "measured"; readonly value: number }
  | { readonly status: "unknown"; readonly reason: string };

export interface OperationalMeasurements {
  readonly latencyMs: Measurement;
  readonly inputTokens: Measurement;
  readonly outputTokens: Measurement;
  readonly totalTokens: Measurement;
  readonly costUsd: Measurement;
}

export interface JudgeRequest {
  readonly caseId: string;
  readonly candidateId: string;
  readonly rubric: string;
  readonly input: string | null;
  readonly expectedOutput: string | null;
  readonly candidateOutput: string;
  /** Rendered judge prompt: all data sections are entity-escaped and wrapped in explicit delimiters. */
  readonly prompt: string;
}

export interface SemanticJudgeAdapter {
  judge(request: JudgeRequest): Promise<unknown>;
}

export interface SemanticJudgment {
  readonly score: number;
  readonly rationale: string;
}

export type JudgeOutcome =
  | { readonly status: "not_requested" }
  | { readonly status: "judged"; readonly score: number; readonly rationale: string }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "skipped"; readonly reason: string };

export interface CaseEvaluation {
  readonly caseId: string;
  readonly candidateId: string;
  readonly completionFixtureId: string;
  readonly model: string | null;
  readonly finishReason: string | null;
  readonly outputCharacters: number;
  readonly deterministic: DeterministicEvaluation;
  readonly judge: JudgeOutcome;
  readonly measurements: OperationalMeasurements;
}

export interface CandidateAggregate {
  readonly caseCount: number;
  readonly passedCaseCount: number;
  readonly deterministicScore: Measurement;
  readonly judgeScore: Measurement;
  readonly latencyMs: Measurement;
  readonly totalTokens: Measurement;
  readonly costUsd: Measurement;
}

export interface CandidateEvaluation {
  readonly candidateId: string;
  readonly cases: readonly CaseEvaluation[];
  readonly aggregate: CandidateAggregate;
}

export interface SuiteEvaluation {
  readonly suiteId: string;
  readonly candidates: readonly CandidateEvaluation[];
  readonly completionsUsed: number;
}

export type OperationalTieBreaker = "totalTokens" | "latencyMs" | "costUsd";

export interface RankingObjective {
  /** Weight of the deterministic score inside the combined quality score. */
  readonly deterministicWeight: number;
  /** Weight of the semantic-judge score inside the combined quality score. */
  readonly judgeWeight: number;
  /** Operational measurements used, in order, only to break exact quality ties. */
  readonly tieBreakers: readonly OperationalTieBreaker[];
}

export interface RankedCandidate {
  readonly rank: number;
  readonly candidateId: string;
  readonly quality: {
    readonly combined: Measurement;
    readonly deterministic: Measurement;
    readonly judge: Measurement;
  };
  readonly operational: {
    readonly latencyMs: Measurement;
    readonly totalTokens: Measurement;
    readonly costUsd: Measurement;
  };
  readonly tiedWith: readonly string[];
  readonly tieBrokenBy: OperationalTieBreaker | null;
}

export interface CandidateSpec {
  readonly pattern: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly label?: string;
}

export interface GenerationBudget {
  readonly maxCandidates: number;
  readonly maxCases: number;
  readonly maxCompletions: number;
}

export interface CandidateProvenance {
  readonly candidateId: string;
  readonly generation: 0 | 1;
  readonly specIndex: number;
  readonly variantIndex: number | null;
  readonly parentCandidateId: string | null;
  readonly fingerprint: string;
}

export interface OptimizationResult {
  readonly candidates: readonly PromptCandidate[];
  readonly provenance: readonly CandidateProvenance[];
  readonly evaluations: readonly CandidateEvaluation[];
  readonly ranking: readonly RankedCandidate[];
  readonly objective: RankingObjective;
  readonly budget: GenerationBudget;
  readonly completionsUsed: number;
}
