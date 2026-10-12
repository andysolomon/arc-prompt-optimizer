/*
 * The rewrite protocol below is adapted from the prompt optimizer in "AI Engineering from Scratch",
 * phases/11-llm-engineering/01-prompt-engineering/outputs/prompt-prompt-optimizer.md
 * (https://github.com/rohitg00/ai-engineering-from-scratch), used under the MIT License:
 *
 *   Copyright (c) 2026 Rohit Ghumare
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 *   associated documentation files (the "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or substantial
 *   portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 *   LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 *   EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 *   IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Adaptations: the optional task-context and use-case inputs are dropped; the temperature guidance moves into a
 * machine-readable <plan> section together with the task type, the objective criteria any good answer must meet
 * (the lesson's evaluation harness checks: word limits, required keywords, forbidden phrases, format), and the
 * patterns from the lesson's selection guide worth trying for the task; the output is reduced to tagged sections
 * that can be parsed reliably; and the rewrite is told to keep the draft's intent and facts and to leave a single
 * delimited slot for any material the draft refers to but does not include. The revise protocol implements the
 * lesson's optimization loop exercise: score, find the failed criteria, revise, repeat.
 */
import { completeWithTimeout, throwIfCompletionAborted } from "../adapters/completion.js";
import { CoreValidationError } from "./errors.js";
import { measureCompletion } from "./evaluation.js";
import { fingerprint } from "./optimize.js";
import { PROMPT_PATTERNS } from "./patterns.js";
import { TASK_TYPES, TASK_VARIABLE, parseRewritePlan } from "./plan.js";
import type { RewritePlan } from "./plan.js";
import { baselineCandidate } from "./preview.js";
import type {
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  OperationalMeasurements,
  PatternName,
  PromptCandidate,
  WeightedCriterionCheck,
} from "./types.js";

/** Largest draft prompt the rewrite accepts; matches the evaluation case input limit. */
export const MAX_REWRITE_DRAFT_CHARACTERS = 16_384;
/** At most this many analysis or change entries are kept from the model's reply. */
export const MAX_REWRITE_NOTES = 32;
/** Each kept analysis or change entry is cut to this many characters. */
export const MAX_REWRITE_NOTE_CHARACTERS = 500;
/** Pattern name and metadata label carried by the rewritten candidate. */
export const REWRITE_PATTERN = "rewrite";
/** Default number of completions spent on a rewrite before giving up: one call plus one retry with a reminder. */
export const DEFAULT_REWRITE_ATTEMPTS = 2;
export const MAX_REWRITE_ATTEMPTS = 3;
/** The failed output shown to the revise step is cut to this many characters. */
export const MAX_REVISE_OUTPUT_CHARACTERS = 1_500;
/** At most this many failed checks are passed to the revise step. */
export const MAX_REVISE_CHECKS = 16;

const PATTERN_GUIDE = PROMPT_PATTERNS.map((pattern) => {
  const extra = pattern.variables.filter((variable) => variable !== TASK_VARIABLE[pattern.name as PatternName]);
  return `- ${pattern.name}: ${pattern.description}${extra.length === 0 ? "" : ` Variables: ${extra.join(", ")}.`}`;
}).join("\n");

export const REWRITE_PROTOCOL = `You are a prompt engineering specialist. You will be given a draft prompt that someone wrote for an LLM. Your job is to rewrite it into a high-quality, production-ready prompt using established patterns, and to plan how any answer to it should be judged.

## Analysis Phase

Before rewriting, analyze the draft prompt for these weaknesses:

1. Vagueness: identify any instruction that could be interpreted multiple ways.
2. Missing format specification: does it specify the output format?
3. Missing constraints: does it set length, tone, audience, or scope boundaries?
4. Missing role: does it establish a persona to activate high-quality training data?
5. Missing examples: would 1-2 few-shot examples improve consistency?
6. Contradictions: do any instructions conflict with each other?
7. Model-specific assumptions: does it rely on behavior specific to one model?

## Rewrite Protocol

Apply these patterns in order:

1. Add a role (Persona Pattern). If the draft has no role, add one. Be specific: not "You are a helpful assistant" but, for example, "You are a senior backend engineer specializing in distributed systems".
2. Clarify the task. Rewrite the core instruction to be unambiguous: state exactly what the output should contain and what it should not contain. If the task has multiple steps, number them.
3. Specify the output format. For JSON, specify keys, types, and constraints. For text, specify length and structure (paragraphs, bullets, numbered). For code, specify language, style, and what to include or exclude.
4. Add constraints. Include at least 3: one positive ("Always..."), one negative ("Do NOT..."), and one conditional ("If X, then Y").
5. Add few-shot examples if applicable. If the task involves a specific format or pattern, add 2 examples showing the exact input/output format expected.
6. Cross-model check. Use plain English with no model-specific syntax, use XML delimiters for structure if needed, do not rely on default behaviors that differ across models, and place critical instructions at the start and end.

Keep the draft's task, intent, and facts. Infer reasonable specifics from the draft, but do not invent data, names, numbers, or requirements it does not imply; note any assumption you make in the analysis. Do not add placeholders for details you can infer. If the draft refers to material it does not include, such as a document, data, or code, keep one clearly delimited slot for that material so the user can paste it in.

## Plan

After rewriting, plan how the prompt will be run and scored:

1. Classify the task as one of: ${TASK_TYPES.join(", ")}.
2. Recommend a temperature: 0.0 for extraction, classification, and code; 0.3 for analysis and summarization; 0.7 for general tasks; 1.0 for creative tasks.
3. State objective criteria that any good answer to this task must satisfy, so outputs from different prompts can be scored the same way. Use only checks the task clearly implies and keep them modest: a word limit the rewritten prompt also states, an output format (json, bullet_list, or numbered_list) only when the whole answer must be in it, up to 6 required keywords that a correct answer cannot avoid mentioning (matched case-insensitively), and phrases a good answer never contains. Leave a check out rather than guess.
4. Choose up to 3 patterns from this list worth trying as alternatives to the rewrite, with task-specific values for each listed variable. The variable that carries the task itself is filled with the draft automatically; do not include it.
${PATTERN_GUIDE}

## Output Format

Reply with exactly these four sections and nothing else:

<analysis>
A bullet list of weaknesses found in the draft prompt.
</analysis>

<rewritten_prompt>
The improved prompt, ready to use. Do not wrap it in a code fence.
</rewritten_prompt>

<changes>
A numbered list of every change made and why.
</changes>

<plan>
One JSON object, no code fence, of the form:
{"task_type": "...", "temperature": 0.3, "criteria": {"max_words": 300, "expected_format": null, "required_keywords": ["..."], "forbidden_phrases": ["..."]}, "patterns": [{"pattern": "persona", "variables": {"role": "...", "experience": "...", "style": "...", "priority": "..."}}]}
</plan>

## Input

Draft prompt to optimize:`;

/** Prepended to the rewrite prompt on a retry after a reply that could not be parsed. */
export const REWRITE_FORMAT_REMINDER = `IMPORTANT: a previous reply to this request could not be parsed because it did not follow the required output format. Reply with exactly the four sections below, using the literal tags <analysis>, <rewritten_prompt>, <changes>, and <plan> on their own lines, and nothing before, between, or after them. Do not use markdown headings in place of the tags. Keep the reply complete; do not stop before the closing </plan> tag.

`;

/** Prepended to the revise prompt on a retry after a reply that could not be parsed. */
export const REVISE_FORMAT_REMINDER = `IMPORTANT: a previous reply to this request could not be parsed because it did not follow the required output format. Reply with exactly the three sections below, using the literal tags <analysis>, <rewritten_prompt>, and <changes> on their own lines, and nothing before, between, or after them. Do not use markdown headings in place of the tags. Keep the reply complete; do not stop before the closing </changes> tag.

`;

export const REVISE_PROTOCOL = `You are a prompt engineering specialist iterating on a prompt. A rewritten prompt was run and its output was scored against objective criteria that any good answer to the task must satisfy. Some checks failed. Your job is to revise the prompt so that a model following it produces an output that passes every failed check, while keeping everything that already works and keeping the original draft's task, intent, and facts.

Treat each failed check as a symptom: find the instruction that is missing, ambiguous, or buried, and fix the prompt rather than appending a bare list of rules. State the limit or format explicitly and put it where the model will not miss it (the start and the end of the prompt). Do not invent data, names, numbers, or requirements the draft does not imply.

## Output Format

Reply with exactly these three sections and nothing else:

<analysis>
A bullet list: for each failed check, why the previous prompt let it fail.
</analysis>

<rewritten_prompt>
The revised prompt, ready to use. Do not wrap it in a code fence.
</rewritten_prompt>

<changes>
A numbered list of every change made and why.
</changes>

## Input
`;

const SECTION = {
  analysis: "analysis",
  prompt: "rewritten_prompt",
  changes: "changes",
  plan: "plan",
} as const;

/** Longest run of backticks in the text, so the draft's fence can always be longer than any fence inside it. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return longest;
}

function fenced(text: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}\n${text}\n${fence}`;
}

function checkDraft(draft: string, label: string): void {
  if (typeof draft !== "string") throw new CoreValidationError("INVALID_CANDIDATE", `${label} must be a string.`);
  if (draft.trim().length === 0) throw new CoreValidationError("INVALID_CANDIDATE", `${label} must not be empty.`);
  if (draft.length > MAX_REWRITE_DRAFT_CHARACTERS) {
    throw new CoreValidationError("INPUT_TOO_LARGE", `${label} is ${draft.length} characters; limit is ${MAX_REWRITE_DRAFT_CHARACTERS}.`);
  }
}

export interface BuildRewritePromptOptions {
  /** Prepends {@link REWRITE_FORMAT_REMINDER}; used on the retry after an unparseable reply. */
  readonly remind?: boolean;
}

/**
 * Builds the meta-prompt that asks a model to rewrite `draft`. The draft is fenced rather than entity-escaped,
 * so prompts that contain their own XML tags reach the model, and come back, unaltered.
 */
export function buildRewritePrompt(draft: string, options: BuildRewritePromptOptions = {}): string {
  checkDraft(draft, "Rewrite draft");
  return `${options.remind === true ? REWRITE_FORMAT_REMINDER : ""}${REWRITE_PROTOCOL}\n${fenced(draft)}`;
}

export interface FailedCheck {
  readonly criterion: string;
  readonly expected: string | number;
  readonly actual: string | number | boolean;
}

export interface ReviseInput {
  /** The user's original draft, for intent. */
  readonly draft: string;
  /** The prompt being revised: the rewrite or the latest revision. */
  readonly prompt: string;
  /** The output the prompt produced, cut to {@link MAX_REVISE_OUTPUT_CHARACTERS} characters. */
  readonly output: string;
  /** Checks the output failed. */
  readonly failedChecks: readonly FailedCheck[];
}

function describeCheck(check: FailedCheck): string {
  return `- ${check.criterion}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`;
}

/** Builds the meta-prompt that asks a model to revise a prompt whose output failed some checks. */
export function buildRevisePrompt(input: ReviseInput): string {
  checkDraft(input.draft, "Revise draft");
  checkDraft(input.prompt, "Revise prompt");
  if (!Array.isArray(input.failedChecks) || input.failedChecks.length === 0) {
    throw new CoreValidationError("INVALID_CANDIDATE", "Revise input needs at least one failed check.");
  }
  const checks = input.failedChecks.slice(0, MAX_REVISE_CHECKS).map(describeCheck).join("\n");
  const output = typeof input.output === "string" ? input.output : "";
  const excerpt = output.length > MAX_REVISE_OUTPUT_CHARACTERS ? `${output.slice(0, MAX_REVISE_OUTPUT_CHARACTERS)}…` : output;
  return `${REVISE_PROTOCOL}
Original draft, for intent:
${fenced(input.draft)}

Prompt to revise:
${fenced(input.prompt)}

Failed checks on the output this prompt produced:
${checks}

The output that failed${output.length > MAX_REVISE_OUTPUT_CHARACTERS ? " (beginning only)" : ""}:
${fenced(excerpt.length === 0 ? "(empty output)" : excerpt)}`;
}

export type RewriteParse =
  | {
      readonly status: "parsed";
      readonly rewrittenPrompt: string;
      readonly analysis: readonly string[];
      readonly changes: readonly string[];
      /** Present when the reply carried a parseable plan. */
      readonly plan?: RewritePlan;
    }
  | { readonly status: "invalid"; readonly reason: string };

/** Content of the last complete `<name>…</name>` section, so reasoning that mentions the tags earlier is ignored. */
function lastSection(text: string, name: string): string | undefined {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const end = text.lastIndexOf(close);
  if (end === -1) return undefined;
  const start = text.lastIndexOf(open, end);
  if (start === -1) return undefined;
  return text.slice(start + open.length, end);
}

const HEADING_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [SECTION.analysis]: Object.freeze(["analysis"]),
  [SECTION.prompt]: Object.freeze(["rewritten prompt", "rewritten_prompt", "improved prompt", "revised prompt", "optimized prompt"]),
  [SECTION.changes]: Object.freeze(["changes", "changes made"]),
  [SECTION.plan]: Object.freeze(["plan"]),
});

/** Matches a markdown heading line such as `## Rewritten Prompt`, `**Changes:**`, or `3. Plan`. */
const HEADING_LINE = /^\s*(?:#{1,6}\s*|\*\*|\d+[.)]\s+)?([A-Za-z][A-Za-z _]*?)\s*:?\s*(?:\*\*)?\s*:?\s*$/u;

function headingName(line: string): string | undefined {
  const match = HEADING_LINE.exec(line);
  if (match === null) return undefined;
  const name = match[1]!.trim().toLowerCase();
  for (const [section, names] of Object.entries(HEADING_NAMES)) if (names.includes(name)) return section;
  return undefined;
}

/**
 * Fallback for replies that use markdown headings instead of the tags: the text under the last heading naming
 * the section, up to the next recognized heading. Only lines that are nothing but a heading count, so a prompt
 * that happens to contain the word "Changes" mid-sentence is not split.
 */
function headingSection(text: string, name: string): string | undefined {
  const lines = text.split(/\r?\n/u);
  let start = -1;
  for (const [index, line] of lines.entries()) if (headingName(line) === name) start = index;
  if (start === -1) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingName(lines[index]!) !== undefined) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function section(text: string, name: string, tagged: boolean): string | undefined {
  return tagged ? lastSection(text, name) : headingSection(text, name);
}

/** Removes one code fence wrapping the whole section, which some models add despite the instruction. */
function unwrapFence(text: string): string {
  const match = /^(`{3,})[^\n`]*\n([\s\S]*?)\n\1\s*$/u.exec(text);
  return match === null ? text : match[2]!;
}

const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/u;

/** Strips markdown emphasis so notes read as plain text. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/gu, "$1").replace(/__(.+?)__/gu, "$1").trim();
}

function notes(section: string | undefined): readonly string[] {
  if (section === undefined) return Object.freeze([]);
  const lines = section.split(/\r?\n/u).map((line) => line.trim());
  const listed = lines.some((line) => LIST_MARKER.test(line));
  const entries: string[] = [];
  for (const line of lines) {
    if (line === "") continue;
    const marked = LIST_MARKER.test(line);
    const item = plain(line.replace(LIST_MARKER, ""));
    if (item === "") continue;
    if (marked || !listed) {
      entries.push(item);
    } else if (entries.length > 0) {
      // A continuation line without its own marker belongs to the previous entry.
      entries[entries.length - 1] = `${entries[entries.length - 1]} ${item}`;
    }
    // An unmarked line before the first list item is a heading such as "Weaknesses found:"; it is dropped.
  }
  return Object.freeze(
    entries.slice(0, MAX_REWRITE_NOTES).map((entry) =>
      entry.length > MAX_REWRITE_NOTE_CHARACTERS ? `${entry.slice(0, MAX_REWRITE_NOTE_CHARACTERS - 1)}…` : entry,
    ),
  );
}

export interface ParseRewriteOptions {
  /** The completion's finish reason, so a reply cut off by the output limit is reported as such. */
  readonly finishReason?: string | null;
}

/**
 * Parses a model reply to {@link buildRewritePrompt} or {@link buildRevisePrompt}. The tagged sections are
 * preferred; a reply that uses markdown headings instead is accepted as a fallback. A missing or empty rewritten
 * prompt is reported, never guessed, and a reply that opens the section but never closes it names the likely
 * cause (the output limit) in the reason.
 */
export function parseRewriteOutput(text: string, options: ParseRewriteOptions = {}): RewriteParse {
  if (typeof text !== "string") return Object.freeze({ status: "invalid", reason: "rewrite reply is not text" });
  const tagged = lastSection(text, SECTION.prompt) !== undefined;
  const raw = section(text, SECTION.prompt, tagged);
  if (raw === undefined) {
    const opened = text.includes(`<${SECTION.prompt}>`);
    const cut = options.finishReason === "length";
    const reason = opened
      ? `rewrite reply opens <${SECTION.prompt}> but never closes it${cut ? " (the reply was cut off at the output limit)" : ""}`
      : cut
        ? `rewrite reply was cut off at the output limit before any <${SECTION.prompt}> section`
        : text.trim().length === 0
          ? "rewrite reply is empty"
          : `rewrite reply has no complete <${SECTION.prompt}> section or 'Rewritten prompt' heading`;
    return Object.freeze({ status: "invalid", reason });
  }
  const rewrittenPrompt = unwrapFence(raw.trim()).trim();
  if (rewrittenPrompt.length === 0) {
    return Object.freeze({ status: "invalid", reason: `rewrite reply has an empty <${SECTION.prompt}> section` });
  }
  const plan = parseRewritePlan(section(text, SECTION.plan, tagged));
  return Object.freeze({
    status: "parsed",
    rewrittenPrompt,
    analysis: notes(section(text, SECTION.analysis, tagged)),
    changes: notes(section(text, SECTION.changes, tagged)),
    ...(plan === undefined ? {} : { plan }),
  });
}

/** Candidate for a rewritten prompt, derived from (and pointing back to) the baseline of `sourcePrompt`. */
export function rewriteCandidate(sourcePrompt: string, rewrittenPrompt: string): PromptCandidate {
  return Object.freeze({
    id: `${REWRITE_PATTERN}-${fingerprint({ rewrite: rewrittenPrompt, source: sourcePrompt })}`,
    prompt: Object.freeze({ pattern: REWRITE_PATTERN, text: rewrittenPrompt, variablesUsed: Object.freeze([]) }),
    origin: "explicit_generation",
    parentCandidateId: baselineCandidate(sourcePrompt).id,
    metadata: Object.freeze({ label: REWRITE_PATTERN }),
  });
}

/** Label carried by revision `round` (2 for the first revision of the rewrite). */
export function revisionLabel(round: number): string {
  return `${REWRITE_PATTERN}_v${round}`;
}

/** Candidate for revision `round` of `parent`, which is the rewrite or the previous revision. */
export function revisionCandidate(parent: PromptCandidate, revisedPrompt: string, round: number): PromptCandidate {
  if (!Number.isSafeInteger(round) || round < 2) throw new CoreValidationError("INVALID_CANDIDATE", "Revision round must be an integer of at least 2.");
  return Object.freeze({
    id: `${REWRITE_PATTERN}-v${round}-${fingerprint({ revision: revisedPrompt, parent: parent.id })}`,
    prompt: Object.freeze({ pattern: REWRITE_PATTERN, text: revisedPrompt, variablesUsed: Object.freeze([]) }),
    origin: "explicit_generation",
    parentCandidateId: parent.id,
    metadata: Object.freeze({ label: revisionLabel(round), revision: round }),
  });
}

/** A retry is skipped when less than this much of `totalTimeoutMs` remains. */
export const MIN_RETRY_TIMEOUT_MS = 5_000;

export interface RewriteOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  /** Timeout of each attempt. */
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
  /** Completions spent before giving up on an unparseable reply; 1 disables the retry. Defaults to {@link DEFAULT_REWRITE_ATTEMPTS}. */
  readonly maxAttempts?: number;
  /**
   * Wall-clock cap across all attempts. A retry gets only what remains of it, and is skipped when less than
   * {@link MIN_RETRY_TIMEOUT_MS} remains, so a slow first attempt cannot double the time spent.
   */
  readonly totalTimeoutMs?: number;
}

export type RewriteOutcome =
  | {
      readonly status: "rewritten";
      readonly candidate: PromptCandidate;
      readonly analysis: readonly string[];
      readonly changes: readonly string[];
      readonly plan?: RewritePlan;
      /** Measurements of the completion that produced the rewrite. */
      readonly measurements: OperationalMeasurements;
      /** Completions spent, including any retry. */
      readonly attempts: number;
    }
  | { readonly status: "invalid"; readonly reason: string; readonly measurements: OperationalMeasurements; readonly attempts: number }
  | { readonly status: "failed"; readonly reason: string; readonly attempts: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "rewrite completion failed";
}

function checkAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_REWRITE_ATTEMPTS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REWRITE_ATTEMPTS) {
    throw new CoreValidationError("INVALID_CANDIDATE", `Rewrite maxAttempts must be an integer between 1 and ${MAX_REWRITE_ATTEMPTS}.`);
  }
  return value;
}

function checkTotalTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CoreValidationError("INVALID_CANDIDATE", "Rewrite totalTimeoutMs must be a positive integer.");
  }
  return value;
}

async function completeOnce(
  adapter: CompletionAdapter,
  prompt: string,
  options: RewriteOptions,
): Promise<{ readonly result: CompletionResult } | { readonly error: string }> {
  const request: CompletionRequest = {
    prompt,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.maxOutputCharacters === undefined ? {} : { maxOutputCharacters: options.maxOutputCharacters }),
  };
  throwIfCompletionAborted(options.signal);
  try {
    const result =
      options.timeoutMs === undefined
        ? await completeWithTimeout(adapter, request, options.signal === undefined ? {} : { signal: options.signal })
        : await completeWithTimeout(adapter, request, {
            timeoutMs: options.timeoutMs,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
    return { result };
  } catch (error) {
    throwIfCompletionAborted(options.signal);
    return { error: errorMessage(error) };
  }
}

type Attempt = (attempt: number) => string;

/**
 * Runs `build(attempt)` through the adapter up to `maxAttempts` times until a reply parses. A completion error ends
 * the loop at once (a second call would most likely fail the same way); only an unparseable reply is retried.
 */
async function rewriteWithRetries(
  adapter: CompletionAdapter,
  build: Attempt,
  options: RewriteOptions,
  toCandidate: (rewrittenPrompt: string) => PromptCandidate,
): Promise<RewriteOutcome> {
  const maxAttempts = checkAttempts(options.maxAttempts);
  const totalTimeoutMs = checkTotalTimeout(options.totalTimeoutMs);
  const started = Date.now();
  let last: RewriteOutcome | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let attemptOptions = options;
    if (totalTimeoutMs !== undefined) {
      const remainingMs = totalTimeoutMs - (Date.now() - started);
      if (attempt > 1 && remainingMs < MIN_RETRY_TIMEOUT_MS) break;
      const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? remainingMs, remainingMs));
      attemptOptions = { ...options, timeoutMs };
    }
    const outcome = await completeOnce(adapter, build(attempt), attemptOptions);
    if ("error" in outcome) return Object.freeze({ status: "failed", reason: outcome.error, attempts: attempt });
    const measurements = measureCompletion(outcome.result);
    const finishReason = (outcome.result as { finishReason?: string | null }).finishReason ?? null;
    const parsed = parseRewriteOutput(outcome.result.text, { finishReason });
    if (parsed.status === "parsed") {
      return Object.freeze({
        status: "rewritten",
        candidate: toCandidate(parsed.rewrittenPrompt),
        analysis: parsed.analysis,
        changes: parsed.changes,
        ...(parsed.plan === undefined ? {} : { plan: parsed.plan }),
        measurements,
        attempts: attempt,
      });
    }
    last = Object.freeze({ status: "invalid", reason: parsed.reason, measurements, attempts: attempt });
  }
  return last!;
}

/**
 * Asks the model to rewrite `prompt` (explicit generation: the caller decides to spend it). A reply that cannot
 * be parsed is retried once with a format reminder by default. Cancellation is rethrown so the caller's run stops;
 * any other completion error or a still-unparseable reply is returned as an outcome so the caller can continue
 * without the rewritten candidate.
 */
export async function rewritePrompt(
  adapter: CompletionAdapter,
  prompt: string,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  checkDraft(prompt, "Rewrite draft");
  return await rewriteWithRetries(
    adapter,
    (attempt) => buildRewritePrompt(prompt, { remind: attempt > 1 }),
    options,
    (rewrittenPrompt) => rewriteCandidate(prompt, rewrittenPrompt),
  );
}

export interface RevisePromptInput extends Omit<ReviseInput, "failedChecks" | "prompt"> {
  /** The candidate being revised: the rewrite or the previous revision. */
  readonly candidate: PromptCandidate;
  /** The revision round this produces; 2 for the first revision. */
  readonly round: number;
  /** Deterministic checks from the candidate's evaluation; only the failed ones are sent. */
  readonly checks: readonly WeightedCriterionCheck[];
}

/**
 * One step of the lesson's optimization loop: asks the model to revise `candidate` so its output passes the checks
 * it failed. Same retry and error handling as {@link rewritePrompt}; the revised prompt comes back as a candidate
 * whose parent is `candidate`.
 */
export async function revisePrompt(
  adapter: CompletionAdapter,
  input: RevisePromptInput,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  const failedChecks = input.checks.filter((check) => !check.passed).map((check) => ({ criterion: check.criterion, expected: check.expected, actual: check.actual }));
  const reviseInput: ReviseInput = { draft: input.draft, prompt: input.candidate.prompt.text, output: input.output, failedChecks };
  const base = buildRevisePrompt(reviseInput);
  return await rewriteWithRetries(
    adapter,
    (attempt) => (attempt > 1 ? `${REVISE_FORMAT_REMINDER}${base}` : base),
    options,
    (revisedPrompt) => revisionCandidate(input.candidate, revisedPrompt, input.round),
  );
}
