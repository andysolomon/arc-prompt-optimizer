import { canonicalStringify } from "./canonical.js";
import { CoreValidationError } from "./errors.js";
import {
  MAX_EVALUATION_CANDIDATES,
  MAX_EVALUATION_CASES,
  MAX_EVALUATION_COMPLETIONS,
  MAX_EVALUATION_PROMPT_CHARACTERS,
  evaluateSuite,
  preflightEvaluationRequests,
  validateEvaluationSuite,
} from "./evaluation.js";
import type { EvaluateOptions } from "./evaluation.js";
import { PatternCatalog, defaultPatternCatalog } from "./patterns.js";
import { rankCandidates, validateRankingObjective } from "./ranking.js";
import { encodedTemplateValueLength, escapeTemplateValue } from "./template.js";
import { expectDenseArray, expectRecord, expectString, readOwnField, rejectUnknownKeys } from "./validation.js";
import type {
  CandidateProvenance,
  CandidateSpec,
  CompletionAdapter,
  EvaluationSuite,
  GenerationBudget,
  OptimizationResult,
  PromptCandidate,
  RankingObjective,
  SemanticJudgeAdapter,
} from "./types.js";

export const MAX_CANDIDATE_SPECS = 16;
export const MAX_CONSTRAINT_VARIANTS = 4;
export const MAX_CONSTRAINT_CHARACTERS = 2_048;

const CONSTRAINT_PREFIX = "\n\n<constraints>\n";
const CONSTRAINT_SUFFIX = "\n</constraints>";

export const DEFAULT_GENERATION_BUDGET: GenerationBudget = Object.freeze({
  maxCandidates: MAX_EVALUATION_CANDIDATES,
  maxCases: MAX_EVALUATION_CASES,
  maxCompletions: MAX_EVALUATION_COMPLETIONS,
});

/** Deterministic 32-bit FNV-1a fingerprint of a canonical value. Not cryptographic; used only for provenance. */
export function fingerprint(value: unknown): string {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface GenerateCandidatesRequest {
  readonly specs: readonly CandidateSpec[];
  /** Optional bounded list of constraint texts appended (escaped and delimited) as first-generation variants. */
  readonly constraintVariants?: readonly string[];
  readonly catalog?: PatternCatalog;
  readonly budget?: Partial<GenerationBudget>;
}

export interface GeneratedCandidates {
  readonly candidates: readonly PromptCandidate[];
  readonly provenance: readonly CandidateProvenance[];
  readonly budget: GenerationBudget;
}

function validateBudget(value: unknown): GenerationBudget {
  if (value === undefined) return DEFAULT_GENERATION_BUDGET;
  const budget = expectRecord(value, "INVALID_OBJECTIVE", "Generation budget");
  rejectUnknownKeys(budget, ["maxCandidates", "maxCases", "maxCompletions"], "INVALID_OBJECTIVE", "Generation budget");
  const checked = { ...DEFAULT_GENERATION_BUDGET } as Record<keyof GenerationBudget, number>;
  for (const name of ["maxCandidates", "maxCases", "maxCompletions"] as const) {
    const limit = readOwnField(budget, name);
    if (limit === undefined) continue;
    if (!Number.isSafeInteger(limit) || (limit as number) <= 0 || (limit as number) > DEFAULT_GENERATION_BUDGET[name]) {
      throw new CoreValidationError(
        "INVALID_OBJECTIVE",
        `Generation budget '${name}' must be a positive safe integer no greater than ${DEFAULT_GENERATION_BUDGET[name]}.`,
      );
    }
    checked[name] = limit as number;
  }
  return Object.freeze(checked);
}

function validateSpec(value: unknown, index: number): CandidateSpec {
  const label = `Candidate spec at index ${index}`;
  const spec = expectRecord(value, "INVALID_CANDIDATE", label);
  rejectUnknownKeys(spec, ["pattern", "variables", "label"], "INVALID_CANDIDATE", label);
  const pattern = expectString(readOwnField(spec, "pattern"), "INVALID_CANDIDATE", `${label} pattern`);
  const variables = expectRecord(readOwnField(spec, "variables"), "INVALID_VARIABLE_VALUE", `${label} variables`);
  const specLabel = readOwnField(spec, "label");
  if (specLabel !== undefined) {
    expectString(specLabel, "INVALID_CANDIDATE", `${label} label`);
    if ((specLabel as string).length > 128) throw new CoreValidationError("INVALID_CANDIDATE", `${label} label exceeds 128 characters.`);
  }
  return {
    pattern,
    variables: variables as Readonly<Record<string, string>>,
    ...(specLabel === undefined ? {} : { label: specLabel as string }),
  };
}

function validateConstraintVariants(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const entries = expectDenseArray(value, "INVALID_CANDIDATE", "Constraint variants");
  if (entries.length > MAX_CONSTRAINT_VARIANTS) {
    throw new CoreValidationError(
      "BUDGET_EXCEEDED",
      `${entries.length} constraint variants exceed the limit of ${MAX_CONSTRAINT_VARIANTS}.`,
    );
  }
  return Object.freeze(
    entries.map((entry, index) => {
      const text = expectString(entry, "INVALID_CANDIDATE", `Constraint variant at index ${index}`);
      if (text.trim() === "") throw new CoreValidationError("INVALID_CANDIDATE", `Constraint variant at index ${index} cannot be empty.`);
      if (text.length > MAX_CONSTRAINT_CHARACTERS) {
        throw new CoreValidationError(
          "INPUT_TOO_LARGE",
          `Constraint variant at index ${index} is ${text.length} characters; limit is ${MAX_CONSTRAINT_CHARACTERS}.`,
        );
      }
      return text;
    }),
  );
}

/**
 * Bounded, explicit candidate generation. Generation 0 renders each spec through the catalog; generation 1
 * appends each constraint variant to each base candidate as escaped, delimited data. There is no iterative
 * search: the candidate count is exactly specs × (1 + constraintVariants), capped by the budget.
 */
export function generateCandidates(request: GenerateCandidatesRequest): GeneratedCandidates {
  const record = expectRecord(request, "INVALID_CANDIDATE", "Generate candidates request");
  rejectUnknownKeys(record, ["specs", "constraintVariants", "catalog", "budget"], "INVALID_CANDIDATE", "Generate candidates request");
  const budget = validateBudget(readOwnField(record, "budget"));
  const specs = expectDenseArray(readOwnField(record, "specs"), "INVALID_CANDIDATE", "Candidate specs").map(validateSpec);
  if (specs.length === 0) throw new CoreValidationError("INVALID_CANDIDATE", "At least one candidate spec is required.");
  if (specs.length > MAX_CANDIDATE_SPECS) {
    throw new CoreValidationError("BUDGET_EXCEEDED", `${specs.length} candidate specs exceed the limit of ${MAX_CANDIDATE_SPECS}.`);
  }
  const variants = validateConstraintVariants(readOwnField(record, "constraintVariants"));
  const catalogValue = readOwnField(record, "catalog");
  if (catalogValue !== undefined && !(catalogValue instanceof PatternCatalog)) {
    throw new CoreValidationError("INVALID_CANDIDATE", "Generate candidates 'catalog' must be a PatternCatalog.");
  }
  const catalog = (catalogValue as PatternCatalog | undefined) ?? defaultPatternCatalog;
  const total = specs.length * (1 + variants.length);
  if (total > budget.maxCandidates) {
    throw new CoreValidationError(
      "BUDGET_EXCEEDED",
      `${specs.length} specs x ${1 + variants.length} variants = ${total} candidates; budget is ${budget.maxCandidates}.`,
    );
  }

  const candidates: PromptCandidate[] = [];
  const provenance: CandidateProvenance[] = [];
  for (const [specIndex, spec] of specs.entries()) {
    const rendered = catalog.render(spec.pattern, spec.variables);
    const baseFingerprint = fingerprint({ pattern: spec.pattern, variables: spec.variables });
    const baseId = `c${specIndex}-${rendered.pattern}-${baseFingerprint}`;
    const label = readOwnField(spec, "label") as string | undefined;
    candidates.push(
      Object.freeze({
        id: baseId,
        prompt: rendered,
        origin: "rendered",
        metadata: Object.freeze({
          pattern: rendered.pattern,
          generation: 0,
          specIndex,
          ...(label === undefined ? {} : { label }),
        }),
      }),
    );
    provenance.push(
      Object.freeze({ candidateId: baseId, generation: 0, specIndex, variantIndex: null, parentCandidateId: null, fingerprint: baseFingerprint }),
    );
    for (const [variantIndex, constraint] of variants.entries()) {
      const length = rendered.text.length + CONSTRAINT_PREFIX.length + encodedTemplateValueLength(constraint) + CONSTRAINT_SUFFIX.length;
      if (length > MAX_EVALUATION_PROMPT_CHARACTERS) {
        throw new CoreValidationError(
          "OUTPUT_TOO_LARGE",
          `Generated constraint variant for candidate '${baseId}' is ${length} characters; limit is ${MAX_EVALUATION_PROMPT_CHARACTERS}.`,
        );
      }
      const text = `${rendered.text}${CONSTRAINT_PREFIX}${escapeTemplateValue(constraint)}${CONSTRAINT_SUFFIX}`;
      const variantFingerprint = fingerprint({ parent: baseFingerprint, constraint });
      const id = `${baseId}-v${variantIndex}-${variantFingerprint}`;
      candidates.push(
        Object.freeze({
          id,
          prompt: Object.freeze({ pattern: rendered.pattern, text, variablesUsed: rendered.variablesUsed }),
          origin: "explicit_generation",
          parentCandidateId: baseId,
          metadata: Object.freeze({
            pattern: rendered.pattern,
            generation: 1,
            specIndex,
            variantIndex,
            ...(label === undefined ? {} : { label }),
          }),
        }),
      );
      provenance.push(
        Object.freeze({ candidateId: id, generation: 1, specIndex, variantIndex, parentCandidateId: baseId, fingerprint: variantFingerprint }),
      );
    }
  }
  return Object.freeze({ candidates: Object.freeze(candidates), provenance: Object.freeze(provenance), budget });
}

export interface OptimizeRequest extends GenerateCandidatesRequest {
  readonly adapter: CompletionAdapter;
  readonly suite: EvaluationSuite;
  readonly judge?: SemanticJudgeAdapter;
  readonly objective?: RankingObjective;
  readonly maxOutputCharacters?: number;
}

/**
 * Explicit, bounded optimization: generate → evaluate every candidate on every case → rank.
 * Nothing is submitted, persisted, or logged; the result is returned to the caller only.
 */
export async function optimize(request: OptimizeRequest): Promise<OptimizationResult> {
  const record = expectRecord(request, "INVALID_CANDIDATE", "Optimize request");
  rejectUnknownKeys(
    record,
    ["specs", "constraintVariants", "catalog", "budget", "adapter", "suite", "judge", "objective", "maxOutputCharacters"],
    "INVALID_CANDIDATE",
    "Optimize request",
  );
  const objective = validateRankingObjective(readOwnField(record, "objective"));
  const suite = validateEvaluationSuite(readOwnField(record, "suite"));
  const generated = generateCandidates({
    specs: readOwnField(record, "specs") as readonly CandidateSpec[],
    ...(readOwnField(record, "constraintVariants") === undefined ? {} : { constraintVariants: readOwnField(record, "constraintVariants") as readonly string[] }),
    ...(readOwnField(record, "catalog") === undefined ? {} : { catalog: readOwnField(record, "catalog") as PatternCatalog }),
    ...(readOwnField(record, "budget") === undefined ? {} : { budget: readOwnField(record, "budget") as Partial<GenerationBudget> }),
  });
  if (suite.cases.length > generated.budget.maxCases) {
    throw new CoreValidationError("BUDGET_EXCEEDED", `Suite '${suite.id}' has ${suite.cases.length} cases; budget is ${generated.budget.maxCases}.`);
  }
  const completions = generated.candidates.length * suite.cases.length;
  if (completions > generated.budget.maxCompletions) {
    throw new CoreValidationError(
      "BUDGET_EXCEEDED",
      `${generated.candidates.length} candidates x ${suite.cases.length} cases = ${completions} completions; budget is ${generated.budget.maxCompletions}.`,
    );
  }
  const judge = readOwnField(record, "judge") as SemanticJudgeAdapter | undefined;
  const maxOutputCharacters = readOwnField(record, "maxOutputCharacters") as number | undefined;
  const options: EvaluateOptions = {
    ...(judge === undefined ? {} : { judge }),
    ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters }),
  };
  const adapter = readOwnField(record, "adapter") as CompletionAdapter;
  const checkedOptions = preflightEvaluationRequests(adapter, generated.candidates, suite, options);
  const evaluation = await evaluateSuite(adapter, generated.candidates, suite, checkedOptions);
  const ranking = rankCandidates(evaluation.candidates, objective);
  return Object.freeze({
    candidates: generated.candidates,
    provenance: generated.provenance,
    evaluations: evaluation.candidates,
    ranking,
    objective,
    budget: generated.budget,
    completionsUsed: evaluation.completionsUsed,
  });
}
