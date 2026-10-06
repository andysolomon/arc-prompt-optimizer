import { fingerprint, generateCandidates } from "./optimize.js";
import { defaultPatternCatalog } from "./patterns.js";
import type { CandidateSpec, EvaluationSuite, PromptCandidate } from "./types.js";

/** Harness-neutral preview candidate set shared by the Pi extension and the model-free CLI tools. */
export const PREVIEW_CANDIDATE_COUNT = 4;

/** One case with minimal criteria: every candidate needs exactly one output. */
export const PREVIEW_SUITE: EvaluationSuite = Object.freeze({
  id: "prompt-optimize-preview",
  cases: Object.freeze([
    Object.freeze({
      id: "preview",
      name: "Preview",
      completionFixtureId: "preview",
      criteria: Object.freeze({ minCharacters: 1 }),
    }),
  ]),
});

function previewSpecs(prompt: string): readonly CandidateSpec[] {
  return Object.freeze([
    Object.freeze({ pattern: "critique", variables: Object.freeze({ task: prompt }), label: "critique" }),
    Object.freeze({ pattern: "decomposition", variables: Object.freeze({ problem: prompt }), label: "decomposition" }),
    Object.freeze({ pattern: "chain_of_thought", variables: Object.freeze({ problem: prompt }), label: "structured_reasoning" }),
  ]);
}

export function baselineCandidate(prompt: string): PromptCandidate {
  return Object.freeze({
    id: `baseline-${fingerprint({ baseline: prompt })}`,
    prompt: Object.freeze({ pattern: "baseline", text: prompt, variablesUsed: Object.freeze([]) }),
    origin: "fixture",
    metadata: Object.freeze({ label: "baseline" }),
  });
}

/** Baseline source prompt followed by the three offline pattern variants. */
export function buildPreviewCandidates(prompt: string): readonly PromptCandidate[] {
  const generated = generateCandidates({
    specs: previewSpecs(prompt),
    catalog: defaultPatternCatalog,
    budget: { maxCandidates: 3, maxCases: PREVIEW_SUITE.cases.length, maxCompletions: 3 * PREVIEW_SUITE.cases.length },
  });
  return Object.freeze([baselineCandidate(prompt), ...generated.candidates]);
}
