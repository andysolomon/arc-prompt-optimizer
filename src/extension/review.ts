import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Measurement, RankedCandidate } from "../core/index.js";
import { candidateLabel } from "./command.js";
import type { PreviewRunResult } from "./run.js";
import type { PromptSource } from "./source.js";

export const REVIEW_SELECT_TITLE = "Review /prompt-optimize candidates";
export const REVIEW_KEEP_OPTION = "Keep current editor text";

/** Above this many DP cells the diff falls back to a multiset line match (still exact for most edits). */
const MAX_LCS_CELLS = 4_000_000;

export interface LineDiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly summary: string;
}

export type ReviewContext = {
  readonly ui: Pick<ExtensionCommandContext["ui"], "select" | "editor" | "confirm" | "getEditorText" | "setEditorText">;
};

export type ReviewOutcome =
  | { readonly status: "kept" }
  | { readonly status: "accepted"; readonly candidateId: string; readonly text: string };

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(/\r?\n/u);
}

function lcsLength(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length * right.length > MAX_LCS_CELLS) {
    const counts = new Map<string, number>();
    for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
    let common = 0;
    for (const line of right) {
      const count = counts.get(line) ?? 0;
      if (count > 0) {
        common += 1;
        counts.set(line, count - 1);
      }
    }
    return common;
  }
  let previous = new Uint32Array(right.length + 1);
  let current = new Uint32Array(right.length + 1);
  for (const leftLine of left) {
    for (let column = 1; column <= right.length; column += 1) {
      current[column] =
        leftLine === right[column - 1] ? previous[column - 1]! + 1 : Math.max(previous[column]!, current[column - 1]!);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length]!;
}

/** Line-level diff counts between the source prompt and a candidate. */
export function lineDiffSummary(source: string, candidate: string): LineDiffSummary {
  const sourceLines = splitLines(source);
  const candidateLines = splitLines(candidate);
  let prefix = 0;
  while (prefix < sourceLines.length && prefix < candidateLines.length && sourceLines[prefix] === candidateLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < sourceLines.length - prefix &&
    suffix < candidateLines.length - prefix &&
    sourceLines[sourceLines.length - 1 - suffix] === candidateLines[candidateLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const middle = lcsLength(
    sourceLines.slice(prefix, sourceLines.length - suffix),
    candidateLines.slice(prefix, candidateLines.length - suffix),
  );
  const unchanged = prefix + suffix + middle;
  const added = candidateLines.length - unchanged;
  const removed = sourceLines.length - unchanged;
  return Object.freeze({ added, removed, unchanged, summary: `+${added} -${removed} lines` });
}

function formatMeasurement(measurement: Measurement, format: (value: number) => string): string {
  return measurement.status === "measured" ? format(measurement.value) : "n/a";
}

function candidateText(result: PreviewRunResult, candidateId: string): string {
  return result.candidates.find((candidate) => candidate.id === candidateId)?.prompt.text ?? "";
}

/** One-line comparison of a ranked candidate against the baseline source prompt. */
export function candidateSummaryLine(result: PreviewRunResult, ranked: RankedCandidate): string {
  const evaluation = result.evaluations.find((entry) => entry.candidateId === ranked.candidateId);
  const passed =
    evaluation !== undefined &&
    evaluation.aggregate.caseCount > 0 &&
    evaluation.aggregate.passedCaseCount === evaluation.aggregate.caseCount;
  const diff = lineDiffSummary(candidateText(result, result.baselineCandidateId), candidateText(result, ranked.candidateId));
  return [
    `${ranked.rank}. ${candidateLabel(result, ranked.candidateId)}`,
    `score ${formatMeasurement(ranked.quality.combined, (value) => value.toFixed(2))}`,
    passed ? "passed" : "failed",
    `latency ${formatMeasurement(ranked.operational.latencyMs, (value) => `${Math.round(value)}ms`)}`,
    `tokens ${formatMeasurement(ranked.operational.totalTokens, (value) => String(Math.round(value)))}`,
    `cost ${formatMeasurement(ranked.operational.costUsd, (value) => `$${value.toFixed(4)}`)}`,
    `diff ${diff.summary}`,
  ].join(" | ");
}

/**
 * select → editor → confirm → setEditorText. Every cancel point keeps the editor unchanged,
 * and nothing is ever submitted.
 */
export async function reviewCandidates(
  ctx: ReviewContext,
  result: PreviewRunResult,
  _source: PromptSource,
): Promise<ReviewOutcome> {
  const kept = Object.freeze({ status: "kept" as const });
  const lines = result.ranking.map((ranked) => candidateSummaryLine(result, ranked));
  const choice = await ctx.ui.select(REVIEW_SELECT_TITLE, [...lines, REVIEW_KEEP_OPTION]);
  const index = choice === undefined ? -1 : lines.indexOf(choice);
  if (index < 0) return kept;

  const candidateId = result.ranking[index]!.candidateId;
  const edited = await ctx.ui.editor(`Edit candidate: ${candidateLabel(result, candidateId)}`, candidateText(result, candidateId));
  if (edited === undefined) return kept;

  const currentLength = ctx.ui.getEditorText().length;
  const confirmed = await ctx.ui.confirm(
    "Replace editor text?",
    `This replaces the current editor text (${currentLength} characters) with the edited candidate (${edited.length} characters). Nothing will be submitted.`,
  );
  if (!confirmed) return kept;

  ctx.ui.setEditorText(edited);
  return Object.freeze({ status: "accepted", candidateId, text: edited });
}
