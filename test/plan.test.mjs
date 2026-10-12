import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_PATTERNS,
  MAX_PLAN_PATTERNS,
  PATTERN_MATRIX,
  PLAN_CASE_ID,
  TASK_TYPES,
  TASK_VARIABLE,
  evaluateOutput,
  generateCandidates,
  listPatterns,
  parseRewritePlan,
  planHasCriteria,
  planPatternSpecs,
  planSuite,
  validateEvaluationSuite,
} from "../dist/core/index.js";

const DRAFT = "Review my flag football app as a coach would.";

test("the matrix covers every task type with catalog patterns only, and every pattern has a task variable", () => {
  const names = new Set(listPatterns().map((pattern) => pattern.name));
  for (const taskType of TASK_TYPES) {
    assert.ok(PATTERN_MATRIX[taskType].length > 0, `${taskType} has patterns`);
    for (const name of PATTERN_MATRIX[taskType]) assert.ok(names.has(name), `${name} is a catalog pattern`);
  }
  for (const pattern of listPatterns()) {
    assert.ok(pattern.variables.includes(TASK_VARIABLE[pattern.name]), `${pattern.name} task variable is declared`);
  }
});

test("parseRewritePlan is lenient: clamps, aliases, dedupes, and drops what it cannot use", () => {
  const plan = parseRewritePlan(
    '```json\n{"task_type": "Data Extraction", "temperature": 5, "criteria": {"max_words": "250", "min_words": 300, "format": "JSON", "required_keywords": ["a", "A", "b", 7, "' +
      "x".repeat(100) +
      '"], "forbidden_phrases": []}, "patterns": ["template_fill", {"name": "few_shot", "variables": {"examples": "Input: a\\nOutput: b"}}]}\n```',
  );
  assert.equal(plan.taskType, "data_extraction");
  assert.deepEqual(plan.criteria, { expectedFormat: "json", maxWords: 250, requiredKeywords: ["a", "b"], forbiddenPhrases: [] });
  // template_fill needs template_structure, which a bare name cannot supply, so only few_shot survives.
  assert.deepEqual(plan.patterns, [{ pattern: "few_shot", variables: { examples: "Input: a\nOutput: b" } }]);
  assert.equal(plan.temperature, undefined, "out-of-range temperature is dropped");
  assert.equal(plan.criteria.minWords, undefined, "min above max is dropped");
  assert.equal(parseRewritePlan(undefined), undefined);
  assert.equal(parseRewritePlan("[]"), undefined);
  assert.equal(parseRewritePlan("{"), undefined);
  assert.equal(parseRewritePlan("Plan: {\"task_type\": \"other\"} done").taskType, "other", "JSON embedded in prose is found");
});

test("parseRewritePlan caps the number of patterns", () => {
  const plan = parseRewritePlan(JSON.stringify({ patterns: ["critique", "decomposition", "chain_of_thought", "persona", "critique"] }));
  assert.equal(plan.patterns.length, MAX_PLAN_PATTERNS);
  assert.deepEqual(plan.patterns.map((entry) => entry.pattern), ["critique", "decomposition", "chain_of_thought"]);
});

test("planSuite builds a valid one-case suite from the criteria and none without any", () => {
  const plan = parseRewritePlan(JSON.stringify({ criteria: { max_words: 120, required_keywords: ["roster", "Scoring"], forbidden_phrases: ["lorem"] } }));
  assert.equal(planHasCriteria(plan), true);
  const suite = planSuite(plan);
  assert.match(suite.id, /^plan-[0-9a-f]{8}$/u);
  const checked = validateEvaluationSuite(suite);
  assert.equal(checked.cases.length, 1);
  assert.equal(checked.cases[0].id, PLAN_CASE_ID);
  assert.deepEqual(checked.cases[0].criteria, { minCharacters: 1, maxWords: 120, requiredKeywords: ["roster", "Scoring"], forbiddenPhrases: ["lorem"] });
  const good = evaluateOutput("The roster and scoring screens work.", checked.cases[0].criteria);
  assert.equal(good.passed, true);
  assert.equal(good.score, 1);
  const bad = evaluateOutput("Lorem ipsum.", checked.cases[0].criteria);
  assert.equal(bad.passed, false);
  assert.ok(bad.score < 1 && bad.score > 0, "partial credit per check");
  assert.equal(planSuite(parseRewritePlan("{}")), undefined);
  assert.equal(planSuite(undefined), undefined);
  assert.equal(planHasCriteria(undefined), false);
});

test("planPatternSpecs renders the plan's patterns with the draft as the task", () => {
  const plan = parseRewritePlan(
    JSON.stringify({
      task_type: "summarization",
      patterns: [{ pattern: "persona", variables: { role: "a CFO", experience: "10 years", style: "terse", priority: "accuracy", task: "ignored" } }, "critique"],
    }),
  );
  const specs = planPatternSpecs(plan, DRAFT);
  assert.deepEqual(specs, [
    { pattern: "persona", variables: { role: "a CFO", experience: "10 years", style: "terse", priority: "accuracy", task: DRAFT }, label: "persona" },
    { pattern: "critique", variables: { task: DRAFT }, label: "critique" },
  ]);
  const generated = generateCandidates({ specs });
  assert.equal(generated.candidates.length, 2);
  assert.ok(generated.candidates[0].prompt.text.startsWith("You are a CFO with 10 years."));
  assert.ok(generated.candidates[0].prompt.text.includes(DRAFT));
});

test("planPatternSpecs falls back to the matrix row, then to the preview trio", () => {
  const reasoning = planPatternSpecs(parseRewritePlan(JSON.stringify({ task_type: "multi_step_reasoning" })), DRAFT);
  assert.deepEqual(reasoning.map((spec) => spec.pattern), ["chain_of_thought", "decomposition"]);
  const summarization = planPatternSpecs(parseRewritePlan(JSON.stringify({ task_type: "summarization" })), DRAFT);
  assert.deepEqual(summarization.map((spec) => spec.pattern), [...FALLBACK_PATTERNS], "rows that need extra variables fall back to the trio");
  assert.deepEqual(planPatternSpecs(undefined, DRAFT).map((spec) => spec.pattern), [...FALLBACK_PATTERNS]);
  for (const spec of planPatternSpecs(undefined, DRAFT)) assert.deepEqual(spec.variables, { [TASK_VARIABLE[spec.pattern]]: DRAFT });
});
