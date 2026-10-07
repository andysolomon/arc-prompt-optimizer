import { baselineCandidate, generateCandidates, listPatterns } from "@/lib/arc-core/core/index.js";
import type { PatternName, PromptCandidate } from "@/lib/arc-core/core/index.js";

export const OPTIMIZE_PATTERNS = listPatterns();

/** Generic defaults preserve the supplied task without inventing domain-specific facts. */
function patternVariables(prompt: string): Record<PatternName, Readonly<Record<string, string>>> {
  return {
    persona: { role: "a careful assistant", experience: "experience following detailed task instructions", style: "clear and precise, following the requested style", priority: "the task's instructions and factual accuracy", task: prompt },
    few_shot: {
      examples: "These examples illustrate following instructions; use the actual task's format and facts.\nInput: Return only the uppercase version of hello.\nOutput: HELLO\n\nInput: Extract the owner from: Owner: Sam. Return only the name.\nOutput: Sam",
      input: prompt,
    },
    chain_of_thought: { problem: prompt },
    template_fill: { text: prompt, template_structure: "Requested answer: Fulfill the task in source_text using its supplied information and requested output format. Omit this field label if the task requires an exact format.\nMissing information: Mention only facts needed for the task that were not supplied; do not invent them." },
    critique: { task: prompt },
    guardrail: { role: "careful assistant", domain: "the task and subject described in the user question", additional_rules: "Follow the task's output format and constraints. Distinguish supplied facts from assumptions.", question: prompt },
    decomposition: { problem: prompt },
    audience_adapt: { concept: prompt, audience: "the audience specified in the task, or a general reader if none is specified", length: "Follow the task's length requirement; otherwise keep the answer concise.", include: "Everything required to fulfill the task, including its requested output format.", exclude: "Unsupported facts, irrelevant detail, and anything the task explicitly excludes." },
    boundary: { scope: "the task and subject described in the user input", refusal_message: "This is outside my scope.", user_input: prompt },
  };
}

/** Baseline plus one rendered candidate for every catalog pattern. */
export function buildPatternCandidates(prompt: string): readonly PromptCandidate[] {
  const variables = patternVariables(prompt);
  const generated = generateCandidates({
    specs: OPTIMIZE_PATTERNS.map((pattern) => ({ pattern: pattern.name, variables: variables[pattern.name as PatternName], label: pattern.name })),
    budget: { maxCandidates: OPTIMIZE_PATTERNS.length, maxCases: 1, maxCompletions: OPTIMIZE_PATTERNS.length },
  });
  return [baselineCandidate(prompt), ...generated.candidates];
}
