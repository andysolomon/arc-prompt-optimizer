import { baselineCandidate, generateCandidates, listPatterns, planPatternSpecs } from "@/lib/arc-core/core/index.js";
import type { PromptCandidate, RewritePlan } from "@/lib/arc-core/core/index.js";

export const OPTIMIZE_PATTERNS = listPatterns();

/**
 * Baseline plus the pattern variants the plan chose for the task (with the plan's task-specific variable values and
 * the draft as the task), or, without a usable plan, the pattern trio that needs only the task text. See
 * `planPatternSpecs` in the core for the selection rules.
 */
export function buildPatternCandidates(prompt: string, plan?: RewritePlan): readonly PromptCandidate[] {
  const specs = planPatternSpecs(plan, prompt);
  const generated = generateCandidates({
    specs,
    budget: { maxCandidates: specs.length, maxCases: 1, maxCompletions: specs.length },
  });
  return [baselineCandidate(prompt), ...generated.candidates];
}
