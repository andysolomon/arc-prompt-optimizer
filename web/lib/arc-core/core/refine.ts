/*
 * Bounded iterative refinement. `rewritePrompt` (rewrite.ts) improves a draft once, blind to how a model answers
 * it. This module closes the loop: evaluate the prompt on a suite, show the model what its outputs got wrong
 * (failed checks, judge verdicts, output excerpts), sample a few revisions at a higher temperature, keep the one
 * that scores best, and repeat for a fixed number of rounds. It is explicit generation: the caller sets the
 * rounds, the variants per round, and the completion budget, and nothing calls it automatically.
 */
import {
  MAX_COMPLETION_PROMPT_CHARACTERS,
  completeWithTimeout,
  throwIfCompletionAborted,
  validateTemperature,
} from "../adapters/completion.js";
import { CoreValidationError } from "./errors.js";
import {
  MAX_EVALUATION_COMPLETIONS,
  buildEvaluationPrompt,
  evaluateCandidate,
  measureCompletion,
  validateEvaluationSuite,
  validatePromptCandidate,
} from "./evaluation.js";
import type { EvaluateOptions } from "./evaluation.js";
import { fingerprint } from "./optimize.js";
import { rankCandidates, validateRankingObjective } from "./ranking.js";
import { MAX_REWRITE_DRAFT_CHARACTERS, parseRewriteOutput } from "./rewrite.js";
import { escapeTemplateValue } from "./template.js";
import { expectDenseArray, expectRecord, expectString, readOwnField, rejectUnknownKeys } from "./validation.js";
import type {
  CandidateEvaluation,
  CaseEvaluation,
  CompletionAdapter,
  CompletionRequest,
  EvaluationSuite,
  OperationalMeasurements,
  PromptCandidate,
  RankedCandidate,
  RankingObjective,
  SemanticJudgeAdapter,
} from "./types.js";

/** Pattern name and metadata label carried by every refined candidate. */
export const REFINE_PATTERN = "refine";
export const MAX_REFINE_ROUNDS = 4;
export const MAX_REFINE_VARIANTS = 4;
export const DEFAULT_REFINE_ROUNDS = 2;
export const DEFAULT_REFINE_VARIANTS = 2;
/** Revisions are sampled above the usual default so the variants of one round actually differ. */
export const DEFAULT_REFINE_TEMPERATURE = 0.9;
/** Each output excerpt shown to the model is cut to this many characters. */
export const MAX_REFINE_OUTPUT_EXCERPT_CHARACTERS = 1_500;
/** The evidence block is capped here; cases that do not fit are counted, not shown. */
export const MAX_REFINE_EVIDENCE_CHARACTERS = 12_000;
/** Each rejected revision is summarized from its change notes, cut to this many characters. */
export const MAX_REFINE_REJECTED_CHARACTERS = 400;

export const REFINE_PROTOCOL = `You are a prompt engineering specialist. You will be given a prompt that is already in use, together with evidence of how a model actually responded to it and where those responses fell short. Your job is to produce a revised prompt that fixes the observed failures while keeping everything that worked.

## Instructions

1. Read the evidence first. Each case shows the input the model received (if any), an excerpt of its output, the deterministic checks that failed, and the judge's verdict when there is one.
2. Diagnose which instructions in the current prompt caused each failure: vague wording, a missing format rule, a missing constraint, a missing example, or a contradiction.
3. Revise the prompt to address those causes directly. Change what caused the failures; keep the parts that produced good output.
4. Keep the prompt's task, intent, and facts. Do not invent data, names, numbers, or requirements the prompt does not imply, and keep any delimited slot for material the user pastes in.
5. Revisions that were already tried and scored no better are listed so you do not repeat them. Make a materially different change, not a reword.

## Output Format

Reply with exactly these three sections and nothing else:

<analysis>
A bullet list connecting each observed failure to the instruction that caused it.
</analysis>

<rewritten_prompt>
The revised prompt, ready to use. Do not wrap it in a code fence.
</rewritten_prompt>

<changes>
A numbered list of every change made and why.
</changes>

## Input

Current prompt:`;

/** What one evaluation case showed about the current prompt; every field is data, never an instruction. */
export interface RefineEvidenceCase {
  readonly caseId: string;
  readonly caseName: string;
  readonly input: string | null;
  readonly output: string;
  readonly failedChecks: readonly { readonly id: string; readonly expected: string | number; readonly actual: string | number | boolean }[];
  readonly passedCheckCount: number;
  readonly judge: { readonly score: number; readonly rationale: string } | null;
}

/** A revision from an earlier round that did not beat the incumbent, summarized so the model does not repeat it. */
export interface RefineRejectedRevision {
  readonly round: number;
  readonly score: number | null;
  readonly changes: readonly string[];
}

export interface RefinePromptInput {
  readonly prompt: string;
  readonly evidence: readonly RefineEvidenceCase[];
  readonly rejected?: readonly RefineRejectedRevision[];
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return longest;
}

function excerpt(text: string, limit: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1)}…`, truncated: true };
}

function formatValue(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function renderCase(entry: RefineEvidenceCase): string {
  const lines = [`<case id="${escapeTemplateValue(entry.caseId)}" name="${escapeTemplateValue(entry.caseName)}">`];
  if (entry.input !== null) lines.push(`<input>\n${escapeTemplateValue(entry.input)}\n</input>`);
  const output = excerpt(entry.output, MAX_REFINE_OUTPUT_EXCERPT_CHARACTERS);
  lines.push(`<output${output.truncated ? ' truncated="true"' : ""}>\n${escapeTemplateValue(output.text)}\n</output>`);
  if (entry.failedChecks.length === 0) {
    lines.push(`<failed_checks>none (${entry.passedCheckCount} passed)</failed_checks>`);
  } else {
    lines.push("<failed_checks>");
    for (const check of entry.failedChecks) {
      lines.push(`- ${escapeTemplateValue(check.id)}: expected ${escapeTemplateValue(formatValue(check.expected))}, got ${escapeTemplateValue(formatValue(check.actual))}`);
    }
    lines.push(`</failed_checks>`);
  }
  if (entry.judge !== null) {
    lines.push(`<judge score="${entry.judge.score.toFixed(2)}">\n${escapeTemplateValue(entry.judge.rationale)}\n</judge>`);
  }
  lines.push("</case>");
  return lines.join("\n");
}

/** Failing cases first, then the lowest judge scores, so the most informative evidence survives the cap. */
function evidencePriority(entry: RefineEvidenceCase): number {
  const failed = entry.failedChecks.length > 0 ? 0 : 1;
  const judge = entry.judge === null ? 1 : entry.judge.score;
  return failed + judge;
}

/**
 * Builds the meta-prompt that asks a model to revise `prompt` in light of `evidence`. The prompt is fenced like
 * the rewrite draft so its own XML survives; the evidence is entity-escaped inside explicit delimiters.
 */
export function buildRefinePrompt(input: RefinePromptInput): string {
  const record = expectRecord(input, "INVALID_CANDIDATE", "Refine prompt input");
  rejectUnknownKeys(record, ["prompt", "evidence", "rejected"], "INVALID_CANDIDATE", "Refine prompt input");
  const prompt = expectString(readOwnField(record, "prompt"), "INVALID_CANDIDATE", "Refine prompt");
  if (prompt.trim().length === 0) throw new CoreValidationError("INVALID_CANDIDATE", "Refine prompt must not be empty.");
  if (prompt.length > MAX_REWRITE_DRAFT_CHARACTERS) {
    throw new CoreValidationError("INPUT_TOO_LARGE", `Refine prompt is ${prompt.length} characters; limit is ${MAX_REWRITE_DRAFT_CHARACTERS}.`);
  }
  const evidence = expectDenseArray(readOwnField(record, "evidence"), "INVALID_CANDIDATE", "Refine evidence") as readonly RefineEvidenceCase[];
  if (evidence.length === 0) throw new CoreValidationError("INVALID_CANDIDATE", "Refine evidence must contain at least one case.");
  const rejectedValue = readOwnField(record, "rejected");
  const rejected =
    rejectedValue === undefined
      ? []
      : (expectDenseArray(rejectedValue, "INVALID_CANDIDATE", "Refine rejected revisions") as readonly RefineRejectedRevision[]);

  const fence = "`".repeat(Math.max(3, longestBacktickRun(prompt) + 1));
  const parts = [`${REFINE_PROTOCOL}\n${fence}\n${prompt}\n${fence}`];

  const ordered = [...evidence].sort((left, right) => evidencePriority(left) - evidencePriority(right));
  const shown: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const entry of ordered) {
    const rendered = renderCase(entry);
    if (shown.length > 0 && used + rendered.length > MAX_REFINE_EVIDENCE_CHARACTERS) {
      omitted += 1;
      continue;
    }
    shown.push(rendered);
    used += rendered.length;
  }
  const omittedNote = omitted > 0 ? `\n<omitted_cases count="${omitted}">further cases did not fit; the ones shown had the most failures</omitted_cases>` : "";
  parts.push(`Evidence from running the current prompt (${evidence.length} case${evidence.length === 1 ? "" : "s"}, ordered worst first):\n<evidence>\n${shown.join("\n")}${omittedNote}\n</evidence>`);

  if (rejected.length > 0) {
    const lines = rejected.map((entry) => {
      const summary = excerpt(entry.changes.join(" "), MAX_REFINE_REJECTED_CHARACTERS).text;
      const score = entry.score === null ? "unscored" : `score ${entry.score.toFixed(2)}`;
      return `- Round ${entry.round}, ${score}: ${escapeTemplateValue(summary === "" ? "(no change notes)" : summary)}`;
    });
    parts.push(`Revisions already tried that did not beat the current prompt:\n<rejected_revisions>\n${lines.join("\n")}\n</rejected_revisions>`);
  }
  const text = parts.join("\n\n");
  if (text.length > MAX_COMPLETION_PROMPT_CHARACTERS) {
    throw new CoreValidationError("INPUT_TOO_LARGE", `Refine prompt is ${text.length} characters; limit is ${MAX_COMPLETION_PROMPT_CHARACTERS}.`);
  }
  return text;
}

/** Candidate for a refined prompt in `round`, pointing back to the candidate it revised. */
export function refineCandidate(parent: PromptCandidate, round: number, variantIndex: number, text: string): PromptCandidate {
  return Object.freeze({
    id: `${REFINE_PATTERN}-r${round}-v${variantIndex}-${fingerprint({ parent: parent.id, refine: text })}`,
    prompt: Object.freeze({ pattern: REFINE_PATTERN, text, variablesUsed: Object.freeze([]) }),
    origin: "explicit_generation",
    parentCandidateId: parent.id,
    metadata: Object.freeze({ label: REFINE_PATTERN, round, variant: variantIndex }),
  });
}

/** Turns a candidate's evaluation and captured outputs into the evidence the refine prompt shows. */
export function evidenceFromEvaluation(
  suite: EvaluationSuite,
  evaluation: CandidateEvaluation,
  outputs: Readonly<Record<string, string>>,
): readonly RefineEvidenceCase[] {
  const byCase = new Map<string, CaseEvaluation>(evaluation.cases.map((entry) => [entry.caseId, entry]));
  return Object.freeze(
    suite.cases.map((evaluationCase) => {
      const entry = byCase.get(evaluationCase.id);
      const output = readOwnField(outputs, evaluationCase.id);
      const checks = entry?.deterministic.checks ?? [];
      return Object.freeze({
        caseId: evaluationCase.id,
        caseName: evaluationCase.name,
        input: (readOwnField(evaluationCase, "input") as string | undefined) ?? null,
        output: typeof output === "string" ? output : "",
        failedChecks: Object.freeze(checks.filter((check) => !check.passed).map((check) => ({ id: check.id, expected: check.expected, actual: check.actual }))),
        passedCheckCount: checks.filter((check) => check.passed).length,
        judge: entry !== undefined && entry.judge.status === "judged" ? { score: entry.judge.score, rationale: entry.judge.rationale } : null,
      });
    }),
  );
}

export type RefineAttempt =
  | {
      readonly variantIndex: number;
      readonly status: "evaluated";
      readonly candidateId: string;
      readonly analysis: readonly string[];
      readonly changes: readonly string[];
      readonly measurements: OperationalMeasurements;
    }
  | { readonly variantIndex: number; readonly status: "duplicate"; readonly candidateId: string }
  | { readonly variantIndex: number; readonly status: "invalid"; readonly reason: string }
  | { readonly variantIndex: number; readonly status: "failed"; readonly reason: string };

export interface RefineRound {
  readonly round: number;
  readonly parentCandidateId: string;
  readonly attempts: readonly RefineAttempt[];
  /** Best candidate after this round: a new one when `improved`, otherwise the parent. */
  readonly bestCandidateId: string;
  readonly improved: boolean;
}

export type RefineStopReason = "rounds_exhausted" | "perfect_score" | "budget_exhausted";

export interface RefineResult {
  readonly startCandidateId: string;
  readonly bestCandidateId: string;
  /** The start candidate followed by every evaluated revision, in the order they were produced. */
  readonly candidates: readonly PromptCandidate[];
  readonly evaluations: readonly CandidateEvaluation[];
  readonly ranking: readonly RankedCandidate[];
  readonly rounds: readonly RefineRound[];
  readonly stopReason: RefineStopReason;
  /** Completions made by this call: refine generations plus evaluation completions. */
  readonly completionsUsed: number;
}

/** Evaluation and captured outputs of the start candidate when the caller already has them. */
export interface RefineStartEvaluation {
  readonly evaluation: CandidateEvaluation;
  readonly outputs: Readonly<Record<string, string>>;
}

export interface RefineRequest {
  readonly adapter: CompletionAdapter;
  /** Prompt text, or a candidate whose id the result keeps. */
  readonly start: string | PromptCandidate;
  readonly suite: EvaluationSuite;
  /** Skips the round-0 evaluation when the caller has already run and judged the start candidate on `suite`. */
  readonly startEvaluation?: RefineStartEvaluation;
  readonly rounds?: number;
  readonly variantsPerRound?: number;
  /** Sampling temperature for the refine generations only; evaluations run at `evaluateOptions.temperature`. */
  readonly temperature?: number;
  readonly judge?: SemanticJudgeAdapter;
  readonly objective?: RankingObjective;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
  /** Cap on completions this call may make, generations and evaluations together. */
  readonly maxCompletions?: number;
  /** Called after each round completes, before the next starts. */
  readonly onRound?: (round: RefineRound) => void;
}

function positiveLimit(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > max) {
    throw new CoreValidationError("INVALID_OBJECTIVE", `Refine '${name}' must be a positive safe integer no greater than ${max}.`);
  }
  return value as number;
}

/** Records the completion output for each evaluation prompt so the next round can show the model what it produced. */
class OutputRecordingAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;
  readonly outputs = new Map<string, string>();

  constructor(inner: CompletionAdapter) {
    this.#inner = inner;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal) {
    const result = await this.#inner.complete(request, signal);
    if (typeof result.text === "string") this.outputs.set(request.prompt, result.text);
    return result;
  }
}

function outputsByCase(suite: EvaluationSuite, candidate: PromptCandidate, recorded: ReadonlyMap<string, string>): Readonly<Record<string, string>> {
  const outputs: Record<string, string> = {};
  for (const evaluationCase of suite.cases) {
    const text = recorded.get(buildEvaluationPrompt(candidate, evaluationCase));
    if (text !== undefined) outputs[evaluationCase.id] = text;
  }
  return Object.freeze(outputs);
}

function validateStartEvaluation(value: unknown, start: PromptCandidate, suite: EvaluationSuite): RefineStartEvaluation | undefined {
  if (value === undefined) return undefined;
  const record = expectRecord(value, "INVALID_EVALUATION", "Refine startEvaluation");
  rejectUnknownKeys(record, ["evaluation", "outputs"], "INVALID_EVALUATION", "Refine startEvaluation");
  const evaluation = expectRecord(readOwnField(record, "evaluation"), "INVALID_EVALUATION", "Refine startEvaluation.evaluation") as unknown as CandidateEvaluation;
  if (readOwnField(evaluation, "candidateId") !== start.id) {
    throw new CoreValidationError("INVALID_EVALUATION", "Refine startEvaluation.evaluation must belong to the start candidate.");
  }
  const cases = expectDenseArray(readOwnField(evaluation, "cases"), "INVALID_EVALUATION", "Refine startEvaluation.evaluation.cases");
  const caseIds = new Set(cases.map((entry) => readOwnField(expectRecord(entry, "INVALID_EVALUATION", "Refine start case evaluation"), "caseId")));
  for (const evaluationCase of suite.cases) {
    if (!caseIds.has(evaluationCase.id)) {
      throw new CoreValidationError("INVALID_EVALUATION", `Refine startEvaluation.evaluation has no case '${evaluationCase.id}' from the suite.`);
    }
  }
  const outputs = expectRecord(readOwnField(record, "outputs"), "INVALID_EVALUATION", "Refine startEvaluation.outputs");
  const checked: Record<string, string> = {};
  for (const evaluationCase of suite.cases) {
    const text = readOwnField(outputs, evaluationCase.id);
    if (text !== undefined) checked[evaluationCase.id] = expectString(text, "INVALID_EVALUATION", `Refine startEvaluation.outputs['${evaluationCase.id}']`);
  }
  return Object.freeze({ evaluation, outputs: Object.freeze(checked) });
}

function combinedScore(ranking: readonly RankedCandidate[], candidateId: string): number | null {
  const entry = ranking.find((ranked) => ranked.candidateId === candidateId);
  return entry !== undefined && entry.quality.combined.status === "measured" ? entry.quality.combined.value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "refine completion failed";
}

/**
 * Evaluate → show the model the failures → sample revisions → keep the best → repeat, for at most `rounds`
 * rounds. Ties keep the incumbent, so a revision replaces the current best only when it scores strictly better
 * under `objective`. Cancellation is rethrown; a revision whose generation or evaluation fails is recorded as a
 * failed attempt and the round continues with the others. Nothing is submitted, persisted, or logged.
 */
export async function refinePrompt(request: RefineRequest): Promise<RefineResult> {
  const record = expectRecord(request, "INVALID_CANDIDATE", "Refine request");
  rejectUnknownKeys(
    record,
    ["adapter", "start", "suite", "startEvaluation", "rounds", "variantsPerRound", "temperature", "judge", "objective", "model", "signal", "timeoutMs", "maxOutputCharacters", "maxCompletions", "onRound"],
    "INVALID_CANDIDATE",
    "Refine request",
  );
  const adapterValue = readOwnField(record, "adapter");
  if (adapterValue === null || typeof adapterValue !== "object" || typeof (adapterValue as { complete?: unknown }).complete !== "function") {
    throw new CoreValidationError("INVALID_EVALUATION", "Refine adapter must expose a complete(request, signal?) method.");
  }
  const adapter = adapterValue as CompletionAdapter;
  const suite = validateEvaluationSuite(readOwnField(record, "suite"));
  const startValue = readOwnField(record, "start");
  const start: PromptCandidate =
    typeof startValue === "string"
      ? validatePromptCandidate({
          id: `${REFINE_PATTERN}-r0-${fingerprint({ refine: startValue })}`,
          prompt: { pattern: REFINE_PATTERN, text: startValue, variablesUsed: [] },
          origin: "explicit_generation",
          metadata: { label: REFINE_PATTERN, round: 0 },
        })
      : validatePromptCandidate(startValue);
  const startEvaluation = validateStartEvaluation(readOwnField(record, "startEvaluation"), start, suite);
  const rounds = positiveLimit(readOwnField(record, "rounds"), "rounds", DEFAULT_REFINE_ROUNDS, MAX_REFINE_ROUNDS);
  const variantsPerRound = positiveLimit(readOwnField(record, "variantsPerRound"), "variantsPerRound", DEFAULT_REFINE_VARIANTS, MAX_REFINE_VARIANTS);
  const temperature = validateTemperature(readOwnField(record, "temperature"), "Refine temperature") ?? DEFAULT_REFINE_TEMPERATURE;
  const objective = validateRankingObjective(readOwnField(record, "objective"));
  const maxCompletions = positiveLimit(readOwnField(record, "maxCompletions"), "maxCompletions", MAX_EVALUATION_COMPLETIONS, MAX_EVALUATION_COMPLETIONS);
  const onRound = readOwnField(record, "onRound") as ((round: RefineRound) => void) | undefined;
  if (onRound !== undefined && typeof onRound !== "function") {
    throw new CoreValidationError("INVALID_CANDIDATE", "Refine 'onRound' must be a function when present.");
  }
  const judge = readOwnField(record, "judge") as SemanticJudgeAdapter | undefined;
  const model = readOwnField(record, "model") as string | undefined;
  const signal = readOwnField(record, "signal") as AbortSignal | undefined;
  const timeoutMs = readOwnField(record, "timeoutMs") as number | undefined;
  const maxOutputCharacters = readOwnField(record, "maxOutputCharacters") as number | undefined;
  const evaluateOptions: EvaluateOptions = {
    ...(judge === undefined ? {} : { judge }),
    ...(model === undefined ? {} : { model }),
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters }),
  };
  const recording = new OutputRecordingAdapter(adapter);
  const caseCount = suite.cases.length;
  let completionsUsed = 0;

  const candidates: PromptCandidate[] = [start];
  const evaluations: CandidateEvaluation[] = [];
  const outputs = new Map<string, Readonly<Record<string, string>>>();
  const seenTexts = new Set<string>([start.prompt.text]);

  if (startEvaluation === undefined) {
    if (caseCount > maxCompletions) {
      throw new CoreValidationError("BUDGET_EXCEEDED", `Evaluating the start candidate needs ${caseCount} completions; budget is ${maxCompletions}.`);
    }
    throwIfCompletionAborted(signal);
    evaluations.push(await evaluateCandidate(recording, start, suite, evaluateOptions));
    completionsUsed += caseCount;
    outputs.set(start.id, outputsByCase(suite, start, recording.outputs));
  } else {
    evaluations.push(startEvaluation.evaluation);
    outputs.set(start.id, startEvaluation.outputs);
  }

  let best = start;
  let ranking = rankCandidates(evaluations, objective);
  const roundsDone: RefineRound[] = [];
  const rejected: RefineRejectedRevision[] = [];
  let stopReason: RefineStopReason = "rounds_exhausted";

  for (let round = 1; round <= rounds; round += 1) {
    const bestScore = combinedScore(ranking, best.id);
    if (bestScore !== null && bestScore >= 1) {
      stopReason = "perfect_score";
      break;
    }
    // One generation plus one completion per case for every variant.
    if (completionsUsed + variantsPerRound * (1 + caseCount) > maxCompletions) {
      stopReason = "budget_exhausted";
      break;
    }
    const bestEvaluation = evaluations.find((entry) => entry.candidateId === best.id)!;
    const prompt = buildRefinePrompt({
      prompt: best.prompt.text,
      evidence: evidenceFromEvaluation(suite, bestEvaluation, outputs.get(best.id) ?? {}),
      rejected,
    });
    const generation: CompletionRequest = {
      prompt,
      temperature,
      ...(model === undefined ? {} : { model }),
      ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters }),
    };
    throwIfCompletionAborted(signal);
    const parent = best;
    const roundCandidates: PromptCandidate[] = [];
    const roundEvaluations: CandidateEvaluation[] = [];
    const notes = new Map<string, { analysis: readonly string[]; changes: readonly string[] }>();

    const attempts = await Promise.all(
      Array.from({ length: variantsPerRound }, async (_, variantIndex): Promise<RefineAttempt> => {
        completionsUsed += 1;
        let result;
        try {
          result = await completeWithTimeout(adapter, generation, {
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(signal === undefined ? {} : { signal }),
          });
        } catch (error) {
          throwIfCompletionAborted(signal);
          return { variantIndex, status: "failed", reason: errorMessage(error) };
        }
        const parsed = parseRewriteOutput(result.text);
        if (parsed.status === "invalid") return { variantIndex, status: "invalid", reason: parsed.reason };
        if (seenTexts.has(parsed.rewrittenPrompt)) {
          const existing = candidates.find((entry) => entry.prompt.text === parsed.rewrittenPrompt) ?? roundCandidates.find((entry) => entry.prompt.text === parsed.rewrittenPrompt);
          return { variantIndex, status: "duplicate", candidateId: existing?.id ?? parent.id };
        }
        seenTexts.add(parsed.rewrittenPrompt);
        let candidate: PromptCandidate;
        try {
          candidate = validatePromptCandidate(refineCandidate(parent, round, variantIndex, parsed.rewrittenPrompt));
        } catch (error) {
          return { variantIndex, status: "invalid", reason: errorMessage(error) };
        }
        roundCandidates.push(candidate);
        completionsUsed += caseCount;
        let evaluation: CandidateEvaluation;
        try {
          evaluation = await evaluateCandidate(recording, candidate, suite, evaluateOptions);
        } catch (error) {
          throwIfCompletionAborted(signal);
          roundCandidates.splice(roundCandidates.indexOf(candidate), 1);
          return { variantIndex, status: "failed", reason: errorMessage(error) };
        }
        roundEvaluations.push(evaluation);
        notes.set(candidate.id, { analysis: parsed.analysis, changes: parsed.changes });
        return { variantIndex, status: "evaluated", candidateId: candidate.id, analysis: parsed.analysis, changes: parsed.changes, measurements: measureCompletion(result) };
      }),
    );

    for (const candidate of roundCandidates) {
      candidates.push(candidate);
      outputs.set(candidate.id, outputsByCase(suite, candidate, recording.outputs));
    }
    evaluations.push(...roundEvaluations);
    ranking = rankCandidates(evaluations, objective);
    const top = ranking[0]!;
    const improved = roundCandidates.some((candidate) => candidate.id === top.candidateId) && !top.tiedWith.includes(best.id);
    if (improved) best = roundCandidates.find((candidate) => candidate.id === top.candidateId)!;
    for (const candidate of roundCandidates) {
      if (candidate.id === best.id) continue;
      rejected.push({ round, score: combinedScore(ranking, candidate.id), changes: notes.get(candidate.id)?.changes ?? [] });
    }
    const summary: RefineRound = Object.freeze({
      round,
      parentCandidateId: parent.id,
      attempts: Object.freeze(attempts.map((attempt) => Object.freeze(attempt))),
      bestCandidateId: best.id,
      improved,
    });
    roundsDone.push(summary);
    onRound?.(summary);
  }

  return Object.freeze({
    startCandidateId: start.id,
    bestCandidateId: best.id,
    candidates: Object.freeze(candidates),
    evaluations: Object.freeze(evaluations),
    ranking,
    rounds: Object.freeze(roundsDone),
    stopReason,
    completionsUsed,
  });
}
