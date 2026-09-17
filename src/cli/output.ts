import type {
  CandidateEvaluation,
  GeneratedCandidates,
  OptimizationResult,
  PromptPattern,
  RankedCandidate,
  SuiteEvaluation,
} from "../core/index.js";
import type { HarnessCandidateView, HarnessScoreResult } from "./harness.js";
import { stringifyCliJsonLine } from "./json.js";

function valueOf(measurement: { readonly status: string; readonly value?: number; readonly reason?: string }): string {
  if (measurement.status === "measured") return String(measurement.value);
  return "unknown";
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: readonly string[]): string => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [format(headers), format(widths.map((width) => "-".repeat(width))), ...rows.map(format)].join("\n");
}

function rankRows(ranking: readonly RankedCandidate[]): readonly (readonly string[])[] {
  return ranking.map((entry) => [
    String(entry.rank),
    entry.candidateId,
    valueOf(entry.quality.combined),
    entry.tieBrokenBy ?? "",
  ]);
}

function candidateRows(evaluations: readonly CandidateEvaluation[]): readonly (readonly string[])[] {
  return evaluations.map((entry) => [
    entry.candidateId,
    `${entry.aggregate.passedCaseCount}/${entry.aggregate.caseCount}`,
    valueOf(entry.aggregate.deterministicScore),
  ]);
}

function judgeRows(evaluations: readonly CandidateEvaluation[]): readonly (readonly string[])[] {
  return evaluations.map((entry) => [entry.candidateId, valueOf(entry.aggregate.judgeScore)]);
}

function operationalRows(evaluations: readonly CandidateEvaluation[]): readonly (readonly string[])[] {
  return evaluations.map((entry) => [
    entry.candidateId,
    valueOf(entry.aggregate.latencyMs),
    valueOf(entry.aggregate.totalTokens),
    valueOf(entry.aggregate.costUsd),
  ]);
}

export function redactSuiteEvaluation(result: SuiteEvaluation): object {
  return {
    completionsUsed: result.completionsUsed,
    candidates: result.candidates,
    suiteId: result.suiteId,
  };
}

export function redactOptimization(result: OptimizationResult): object {
  return {
    budget: result.budget,
    completionsUsed: result.completionsUsed,
    evaluations: result.evaluations,
    objective: result.objective,
    provenance: result.provenance,
    ranking: result.ranking,
  };
}

export function fullOptimizationForOutput(result: OptimizationResult): object {
  return {
    budget: result.budget,
    candidates: result.candidates,
    completionsUsed: result.completionsUsed,
    evaluations: result.evaluations,
    objective: result.objective,
    provenance: result.provenance,
    ranking: result.ranking,
  };
}

export function fullEvaluationForOutput(candidate: { readonly prompt: string }, result: SuiteEvaluation): object {
  return {
    prompt: candidate.prompt,
    ...redactSuiteEvaluation(result),
  };
}

export function formatJson(value: unknown): string {
  return stringifyCliJsonLine(value);
}

export function formatPatternsJson(patterns: readonly PromptPattern[]): string {
  return formatJson({
    patterns: patterns.map((pattern) => ({
      description: pattern.description,
      displayName: pattern.displayName,
      name: pattern.name,
      recommendedTemperature: pattern.recommendedTemperature,
      variables: pattern.variables,
    })),
  });
}

export function formatPatternsText(patterns: readonly PromptPattern[]): string {
  return `${table(
    ["Name", "Display", "Variables", "Temp"],
    patterns.map((pattern) => [
      pattern.name,
      pattern.displayName,
      pattern.variables.join(","),
      String(pattern.recommendedTemperature),
    ]),
  )}\n`;
}

export function formatModelsText(models: readonly { readonly canonical: string; readonly provider: string; readonly id: string }[]): string {
  return `${table(
    ["Model", "Provider", "Id"],
    models.map((model) => [model.canonical, model.provider, model.id]),
  )}\n`;
}

export function formatEvaluationText(result: SuiteEvaluation, outputPath: string | undefined): string {
  const sections = [
    `Suite: ${result.suiteId}`,
    "",
    "Heuristic metrics",
    table(["Candidate", "Passed", "Score"], candidateRows(result.candidates)),
    "",
    "Judge metrics",
    table(["Candidate", "Score"], judgeRows(result.candidates)),
    "",
    "Operational metrics",
    table(["Candidate", "LatencyMs", "TotalTokens", "CostUsd"], operationalRows(result.candidates)),
    "",
    `Completions: ${result.completionsUsed}`,
  ];
  if (outputPath !== undefined) sections.push(`Output: ${outputPath}`);
  return `${sections.join("\n")}\n`;
}

export function formatOptimizationText(result: OptimizationResult, outputPath: string | undefined): string {
  const sections = [
    `Completions: ${result.completionsUsed}`,
    "",
    "Ranking",
    table(["Rank", "Candidate", "Quality", "TieBreaker"], rankRows(result.ranking)),
    "",
    "Heuristic metrics",
    table(["Candidate", "Passed", "Score"], candidateRows(result.evaluations)),
    "",
    "Judge metrics",
    table(["Candidate", "Score"], judgeRows(result.evaluations)),
    "",
    "Operational metrics",
    table(["Candidate", "LatencyMs", "TotalTokens", "CostUsd"], operationalRows(result.evaluations)),
  ];
  if (outputPath !== undefined) sections.push("", `Output: ${outputPath}`);
  return `${sections.join("\n")}\n`;
}

export function generatedSpecsSummary(generated: GeneratedCandidates): object {
  return {
    budget: generated.budget,
    candidateIds: generated.candidates.map((candidate) => candidate.id),
    provenance: generated.provenance,
  };
}

export function formatCandidatesJson(candidates: readonly HarnessCandidateView[]): string {
  return formatJson({
    candidates: candidates.map((candidate) => ({ id: candidate.id, pattern: candidate.pattern, prompt: candidate.prompt })),
  });
}

export function formatCandidatesText(candidates: readonly HarnessCandidateView[]): string {
  const sections = candidates.map((candidate) =>
    [`== ${candidate.id} (${candidate.label}, pattern: ${candidate.pattern})`, candidate.prompt].join("\n"),
  );
  return `${sections.join("\n\n")}\n`;
}

export function formatScoreJson(result: HarnessScoreResult): string {
  return formatJson({
    evaluations: result.evaluations,
    objective: result.objective,
    ranking: result.ranking,
    suiteId: result.suiteId,
  });
}

export function formatScoreText(result: HarnessScoreResult): string {
  const sections = [
    `Suite: ${result.suiteId}`,
    "",
    "Ranking",
    table(["Rank", "Candidate", "Quality", "TieBreaker"], rankRows(result.ranking)),
    "",
    "Heuristic metrics",
    table(["Candidate", "Passed", "Score"], candidateRows(result.evaluations)),
    "",
    "Operational metrics",
    table(["Candidate", "LatencyMs", "TotalTokens", "CostUsd"], operationalRows(result.evaluations)),
  ];
  return `${sections.join("\n")}\n`;
}
