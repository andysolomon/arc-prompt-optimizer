import type { Measurement } from "@/lib/types";

export function formatMeasurement(measurement: Measurement | undefined, format: (value: number) => string): string {
  return measurement !== undefined && measurement.status === "measured" ? format(measurement.value) : "n/a";
}

export const formatScore = (m: Measurement | undefined) => formatMeasurement(m, (v) => v.toFixed(2));
export const formatLatency = (m: Measurement | undefined) => formatMeasurement(m, (v) => `${Math.round(v)}ms`);
export const formatTokens = (m: Measurement | undefined) => formatMeasurement(m, (v) => String(Math.round(v)));
export const formatCost = (m: Measurement | undefined) => formatMeasurement(m, (v) => `$${v.toFixed(4)}`);

export function formatCharacterCount(length: number): string {
  return `${length.toLocaleString("en-US")} characters`;
}

const LABELS: Readonly<Record<string, string>> = {
  baseline: "Baseline",
  rewrite: "Rewrite",
  critique: "Critique",
  decomposition: "Decomposition",
  structured_reasoning: "Structured reasoning",
  chain_of_thought: "Structured reasoning",
  persona: "Persona",
  few_shot: "Few-shot",
  template_fill: "Template fill",
  guardrail: "Guardrail",
  audience_adapt: "Audience adaptation",
  boundary: "Boundary",
};

/** Human label for a candidate from its metadata label (or pattern name as a fallback). */
export function candidateLabel(label: string | number | boolean | undefined, pattern: string): string {
  const key = typeof label === "string" ? label : pattern;
  return LABELS[key] ?? key.replace(/_/gu, " ").replace(/^\w/u, (c) => c.toUpperCase());
}
