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
 * Adaptations: the optional task-context and use-case inputs and the temperature/settings section are
 * dropped (candidates are run at the caller's model settings), the output is reduced to three tagged
 * sections that can be parsed reliably, and the rewrite is told to keep the draft's intent and facts and to
 * leave a single delimited slot for any material the draft refers to but does not include.
 */
import { completeWithTimeout, throwIfCompletionAborted } from "../adapters/completion.js";
import { CoreValidationError } from "./errors.js";
import { measureCompletion } from "./evaluation.js";
import { fingerprint } from "./optimize.js";
import { baselineCandidate } from "./preview.js";
import type { CompletionAdapter, CompletionRequest, OperationalMeasurements, PromptCandidate } from "./types.js";

/** Largest draft prompt the rewrite accepts; matches the evaluation case input limit. */
export const MAX_REWRITE_DRAFT_CHARACTERS = 16_384;
/** At most this many analysis or change entries are kept from the model's reply. */
export const MAX_REWRITE_NOTES = 32;
/** Each kept analysis or change entry is cut to this many characters. */
export const MAX_REWRITE_NOTE_CHARACTERS = 500;
/** Pattern name and metadata label carried by the rewritten candidate. */
export const REWRITE_PATTERN = "rewrite";

export const REWRITE_PROTOCOL = `You are a prompt engineering specialist. You will be given a draft prompt that someone wrote for an LLM. Your job is to rewrite it into a high-quality, production-ready prompt using established patterns.

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

## Output Format

Reply with exactly these three sections and nothing else:

<analysis>
A bullet list of weaknesses found in the draft prompt.
</analysis>

<rewritten_prompt>
The improved prompt, ready to use. Do not wrap it in a code fence.
</rewritten_prompt>

<changes>
A numbered list of every change made and why.
</changes>

## Input

Draft prompt to optimize:`;

const SECTION = {
  analysis: "analysis",
  prompt: "rewritten_prompt",
  changes: "changes",
} as const;

/** Longest run of backticks in the text, so the draft's fence can always be longer than any fence inside it. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return longest;
}

/**
 * Builds the meta-prompt that asks a model to rewrite `draft`. The draft is fenced rather than entity-escaped,
 * so prompts that contain their own XML tags reach the model, and come back, unaltered.
 */
export function buildRewritePrompt(draft: string): string {
  if (typeof draft !== "string") throw new CoreValidationError("INVALID_CANDIDATE", "Rewrite draft must be a string.");
  if (draft.trim().length === 0) throw new CoreValidationError("INVALID_CANDIDATE", "Rewrite draft must not be empty.");
  if (draft.length > MAX_REWRITE_DRAFT_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Rewrite draft is ${draft.length} characters; limit is ${MAX_REWRITE_DRAFT_CHARACTERS}.`,
    );
  }
  const fence = "`".repeat(Math.max(3, longestBacktickRun(draft) + 1));
  return `${REWRITE_PROTOCOL}\n${fence}\n${draft}\n${fence}`;
}

export type RewriteParse =
  | {
      readonly status: "parsed";
      readonly rewrittenPrompt: string;
      readonly analysis: readonly string[];
      readonly changes: readonly string[];
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

/** Parses a model reply to {@link buildRewritePrompt}. A missing or empty rewritten prompt is reported, never guessed. */
export function parseRewriteOutput(text: string): RewriteParse {
  if (typeof text !== "string") return Object.freeze({ status: "invalid", reason: "rewrite reply is not text" });
  const section = lastSection(text, SECTION.prompt);
  if (section === undefined) {
    return Object.freeze({ status: "invalid", reason: `rewrite reply has no complete <${SECTION.prompt}> section` });
  }
  const rewrittenPrompt = unwrapFence(section.trim()).trim();
  if (rewrittenPrompt.length === 0) {
    return Object.freeze({ status: "invalid", reason: `rewrite reply has an empty <${SECTION.prompt}> section` });
  }
  return Object.freeze({
    status: "parsed",
    rewrittenPrompt,
    analysis: notes(lastSection(text, SECTION.analysis)),
    changes: notes(lastSection(text, SECTION.changes)),
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

export interface RewriteOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
}

export type RewriteOutcome =
  | {
      readonly status: "rewritten";
      readonly candidate: PromptCandidate;
      readonly analysis: readonly string[];
      readonly changes: readonly string[];
      readonly measurements: OperationalMeasurements;
    }
  | { readonly status: "invalid"; readonly reason: string; readonly measurements: OperationalMeasurements }
  | { readonly status: "failed"; readonly reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "rewrite completion failed";
}

/**
 * One completion that asks the model to rewrite `prompt` (explicit generation: the caller decides to spend it).
 * Cancellation is rethrown so the caller's run stops; any other completion error or an unparseable reply is
 * returned as an outcome so the caller can continue without the rewritten candidate.
 */
export async function rewritePrompt(
  adapter: CompletionAdapter,
  prompt: string,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  const request: CompletionRequest = {
    prompt: buildRewritePrompt(prompt),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.maxOutputCharacters === undefined ? {} : { maxOutputCharacters: options.maxOutputCharacters }),
  };
  throwIfCompletionAborted(options.signal);
  let result;
  try {
    result =
      options.timeoutMs === undefined
        ? await completeWithTimeout(adapter, request, options.signal === undefined ? {} : { signal: options.signal })
        : await completeWithTimeout(adapter, request, {
            timeoutMs: options.timeoutMs,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
  } catch (error) {
    throwIfCompletionAborted(options.signal);
    return Object.freeze({ status: "failed", reason: errorMessage(error) });
  }
  const measurements = measureCompletion(result);
  const parsed = parseRewriteOutput(result.text);
  if (parsed.status === "invalid") return Object.freeze({ status: "invalid", reason: parsed.reason, measurements });
  return Object.freeze({
    status: "rewritten",
    candidate: rewriteCandidate(prompt, parsed.rewrittenPrompt),
    analysis: parsed.analysis,
    changes: parsed.changes,
    measurements,
  });
}
