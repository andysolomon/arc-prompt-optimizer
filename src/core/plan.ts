/*
 * The task-type to pattern matrix below is adapted from the pattern selection guide in "AI Engineering from
 * Scratch", phases/11-llm-engineering/01-prompt-engineering/outputs/skill-prompt-patterns.md
 * (https://github.com/rohitg00/ai-engineering-from-scratch), MIT License; see THIRD_PARTY_NOTICES.md.
 */
import { fingerprint } from "./optimize.js";
import { PROMPT_PATTERNS } from "./patterns.js";
import { readOwnField } from "./validation.js";
import type { CandidateSpec, EvaluationSuite, ExpectedFormat, PatternName } from "./types.js";

/** Task types the rewrite step classifies a draft into; each maps to the patterns worth trying for it. */
export const TASK_TYPES = Object.freeze([
  "data_extraction",
  "classification",
  "summarization",
  "code_generation",
  "creative_writing",
  "multi_step_reasoning",
  "question_answering",
  "content_moderation",
  "translation_adaptation",
  "analysis_review",
  "other",
] as const);

export type TaskType = (typeof TASK_TYPES)[number];

/** Primary and secondary patterns per task type, from the lesson's decision matrix. */
function row(...names: readonly PatternName[]): readonly PatternName[] {
  return Object.freeze([...names]);
}

export const PATTERN_MATRIX: Readonly<Record<TaskType, readonly PatternName[]>> = Object.freeze({
  data_extraction: row("template_fill", "few_shot"),
  classification: row("few_shot", "guardrail"),
  summarization: row("persona", "audience_adapt"),
  code_generation: row("persona", "chain_of_thought"),
  creative_writing: row("persona", "critique"),
  multi_step_reasoning: row("chain_of_thought", "decomposition"),
  question_answering: row("persona", "guardrail", "boundary"),
  content_moderation: row("guardrail", "boundary", "few_shot"),
  translation_adaptation: row("audience_adapt", "few_shot"),
  analysis_review: row("decomposition", "critique", "chain_of_thought"),
  other: row("critique", "decomposition", "chain_of_thought"),
});

/** The variable of each catalog pattern that carries the task itself; it is always filled with the draft. */
export const TASK_VARIABLE: Readonly<Record<PatternName, string>> = Object.freeze({
  persona: "task",
  few_shot: "input",
  chain_of_thought: "problem",
  template_fill: "text",
  critique: "task",
  guardrail: "question",
  decomposition: "problem",
  audience_adapt: "concept",
  boundary: "user_input",
});

/** Patterns tried when the plan names none that can be rendered: the preview trio needs only the task text. */
export const FALLBACK_PATTERNS: readonly PatternName[] = row("critique", "decomposition", "chain_of_thought");

/** At most this many pattern candidates are rendered from a plan. */
export const MAX_PLAN_PATTERNS = 3;
export const MAX_PLAN_TERMS = 10;
export const MAX_PLAN_TERM_CHARACTERS = 64;
export const MAX_PLAN_WORDS = 20_000;
export const MAX_PLAN_VARIABLE_CHARACTERS = 2_000;

export interface PlanCriteria {
  readonly expectedFormat?: ExpectedFormat;
  readonly maxWords?: number;
  readonly minWords?: number;
  readonly requiredKeywords: readonly string[];
  readonly forbiddenPhrases: readonly string[];
}

export interface PlanPattern {
  readonly pattern: PatternName;
  /** Values for the pattern's variables other than its task variable. */
  readonly variables: Readonly<Record<string, string>>;
}

/** The rewrite step's plan: what kind of task the draft is, how to run it, and how to score any answer to it. */
export interface RewritePlan {
  readonly taskType: TaskType;
  readonly temperature?: number;
  readonly criteria: PlanCriteria;
  readonly patterns: readonly PlanPattern[];
}

const PATTERN_NAMES = new Set<string>(PROMPT_PATTERNS.map((pattern) => pattern.name));

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asTerms(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const term = entry.trim();
    if (term === "" || term.length > MAX_PLAN_TERM_CHARACTERS) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === MAX_PLAN_TERMS) break;
  }
  return Object.freeze(terms);
}

function asWordCount(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const count = Math.round(value);
  return count > 0 && count <= MAX_PLAN_WORDS ? count : undefined;
}

const FORMAT_ALIASES: Readonly<Record<string, ExpectedFormat>> = Object.freeze({
  json: "json",
  bullet_list: "bullet_list",
  bullets: "bullet_list",
  bullet_points: "bullet_list",
  bulleted_list: "bullet_list",
  numbered_list: "numbered_list",
  numbered: "numbered_list",
  ordered_list: "numbered_list",
});

function asFormat(value: unknown): ExpectedFormat | undefined {
  if (typeof value !== "string") return undefined;
  return FORMAT_ALIASES[value.trim().toLowerCase().replace(/[\s-]+/gu, "_")];
}

function asTaskType(value: unknown): TaskType {
  if (typeof value !== "string") return "other";
  const key = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  return (TASK_TYPES as readonly string[]).includes(key) ? (key as TaskType) : "other";
}

function asTemperature(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) return undefined;
  return Math.round(value * 100) / 100;
}

function asPatterns(value: unknown): readonly PlanPattern[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const seen = new Set<string>();
  const patterns: PlanPattern[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const name = record === undefined ? entry : (readOwnField(record, "pattern") ?? readOwnField(record, "name"));
    if (typeof name !== "string") continue;
    const pattern = name.trim().toLowerCase().replace(/[\s-]+/gu, "_");
    if (!PATTERN_NAMES.has(pattern) || seen.has(pattern)) continue;
    const definition = PROMPT_PATTERNS.find((candidate) => candidate.name === pattern)!;
    const supplied = asRecord(record === undefined ? undefined : readOwnField(record, "variables")) ?? {};
    const variables: Record<string, string> = {};
    let complete = true;
    for (const variable of definition.variables) {
      if (variable === TASK_VARIABLE[pattern as PatternName]) continue;
      const text = readOwnField(supplied, variable);
      if (typeof text !== "string" || text.trim() === "" || text.length > MAX_PLAN_VARIABLE_CHARACTERS) {
        complete = false;
        break;
      }
      variables[variable] = text.trim();
    }
    if (!complete) continue;
    seen.add(pattern);
    patterns.push(Object.freeze({ pattern: pattern as PatternName, variables: Object.freeze(variables) }));
    if (patterns.length === MAX_PLAN_PATTERNS) break;
  }
  return Object.freeze(patterns);
}

/** Removes one code fence wrapping the whole text, which models often add around JSON. */
function unfence(text: string): string {
  const match = /^\s*(`{3,})[^\n`]*\n([\s\S]*?)\n\1\s*$/u.exec(text);
  return match === null ? text.trim() : match[2]!.trim();
}

/**
 * Parses the JSON plan a rewrite reply carries. The parse is lenient: every field is optional, unknown fields are
 * ignored, invalid entries are dropped rather than failing the plan, and a plan that is not JSON at all is reported
 * as absent (`undefined`) so the caller falls back to the preview suite.
 */
export function parseRewritePlan(text: string | undefined): RewritePlan | undefined {
  if (typeof text !== "string") return undefined;
  const body = unfence(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const criteriaRecord = asRecord(readOwnField(record, "criteria")) ?? record;
  const maxWords = asWordCount(readOwnField(criteriaRecord, "max_words") ?? readOwnField(criteriaRecord, "maxWords"));
  let minWords = asWordCount(readOwnField(criteriaRecord, "min_words") ?? readOwnField(criteriaRecord, "minWords"));
  if (minWords !== undefined && maxWords !== undefined && minWords > maxWords) minWords = undefined;
  const expectedFormat = asFormat(readOwnField(criteriaRecord, "expected_format") ?? readOwnField(criteriaRecord, "expectedFormat") ?? readOwnField(criteriaRecord, "format"));
  const temperature = asTemperature(readOwnField(record, "temperature"));
  return Object.freeze({
    taskType: asTaskType(readOwnField(record, "task_type") ?? readOwnField(record, "taskType")),
    ...(temperature === undefined ? {} : { temperature }),
    criteria: Object.freeze({
      ...(expectedFormat === undefined ? {} : { expectedFormat }),
      ...(maxWords === undefined ? {} : { maxWords }),
      ...(minWords === undefined ? {} : { minWords }),
      requiredKeywords: asTerms(readOwnField(criteriaRecord, "required_keywords") ?? readOwnField(criteriaRecord, "requiredKeywords")),
      forbiddenPhrases: asTerms(readOwnField(criteriaRecord, "forbidden_phrases") ?? readOwnField(criteriaRecord, "forbiddenPhrases")),
    }),
    patterns: asPatterns(readOwnField(record, "patterns")),
  });
}

/** True when the plan carries at least one objective check beyond "the output is not empty". */
export function planHasCriteria(plan: RewritePlan | undefined): boolean {
  if (plan === undefined) return false;
  const { criteria } = plan;
  return (
    criteria.expectedFormat !== undefined ||
    criteria.maxWords !== undefined ||
    criteria.minWords !== undefined ||
    criteria.requiredKeywords.length > 0 ||
    criteria.forbiddenPhrases.length > 0
  );
}

/** Case id of the single case a plan suite holds. */
export const PLAN_CASE_ID = "task";

/**
 * One-case evaluation suite from the plan's criteria, or `undefined` when the plan has none. Every check carries
 * weight 1, so the deterministic score is the fraction of checks an output passes. The non-empty check is kept so a
 * plan suite is never weaker than the preview suite.
 */
export function planSuite(plan: RewritePlan | undefined): EvaluationSuite | undefined {
  if (!planHasCriteria(plan)) return undefined;
  const { criteria } = plan!;
  return Object.freeze({
    id: `plan-${fingerprint(criteria)}`,
    cases: Object.freeze([
      Object.freeze({
        id: PLAN_CASE_ID,
        name: "Task criteria",
        completionFixtureId: "preview",
        criteria: Object.freeze({
          minCharacters: 1,
          ...(criteria.expectedFormat === undefined ? {} : { expectedFormat: criteria.expectedFormat }),
          ...(criteria.maxWords === undefined ? {} : { maxWords: criteria.maxWords }),
          ...(criteria.minWords === undefined ? {} : { minWords: criteria.minWords }),
          ...(criteria.requiredKeywords.length === 0 ? {} : { requiredKeywords: criteria.requiredKeywords }),
          ...(criteria.forbiddenPhrases.length === 0 ? {} : { forbiddenPhrases: criteria.forbiddenPhrases }),
        }),
      }),
    ]),
  });
}

/** Patterns from the matrix for a task type that need nothing but the task text. */
function taskOnlyPatterns(taskType: TaskType): readonly PatternName[] {
  const taskOnly = PROMPT_PATTERNS.filter((pattern) => pattern.variables.length === 1).map((pattern) => pattern.name);
  return PATTERN_MATRIX[taskType].filter((name) => taskOnly.includes(name));
}

/**
 * Candidate specs for the pattern variants of `draft`. The plan's own patterns come first, with their variables and
 * the draft as the task; without any, the matrix row for the task type supplies the patterns that need only the
 * task text, and the preview trio is the last resort. Never more than {@link MAX_PLAN_PATTERNS}.
 */
export function planPatternSpecs(plan: RewritePlan | undefined, draft: string): readonly CandidateSpec[] {
  const specs: CandidateSpec[] = [];
  if (plan !== undefined) {
    for (const entry of plan.patterns) {
      specs.push(
        Object.freeze({
          pattern: entry.pattern,
          variables: Object.freeze({ ...entry.variables, [TASK_VARIABLE[entry.pattern]]: draft }),
          label: entry.pattern,
        }),
      );
    }
  }
  if (specs.length === 0) {
    const names = plan === undefined ? [] : taskOnlyPatterns(plan.taskType);
    for (const name of names.length > 0 ? names : FALLBACK_PATTERNS) {
      specs.push(Object.freeze({ pattern: name, variables: Object.freeze({ [TASK_VARIABLE[name]]: draft }), label: name }));
    }
  }
  return Object.freeze(specs.slice(0, MAX_PLAN_PATTERNS));
}
