import assert from "node:assert/strict";
import test from "node:test";

import {
  CompletionCancelledError,
  DEFAULT_REFINE_TEMPERATURE,
  MAX_REFINE_EVIDENCE_CHARACTERS,
  REFINE_PATTERN,
  REFINE_PROTOCOL,
  baselineCandidate,
  buildRefinePrompt,
  evaluateCandidate,
  evidenceFromEvaluation,
  refineCandidate,
  refinePrompt,
} from "../dist/core/index.js";

const START = "Summarize this incident report for executives.";

const SUITE = Object.freeze({
  id: "refine-test",
  cases: [
    {
      id: "keyword",
      name: "Mentions impact",
      completionFixtureId: "keyword",
      input: "Database outage, 40 minutes, 3 customers affected.",
      criteria: { requiredKeywords: ["impact"], maxWords: 50 },
    },
  ],
});

function reply(prompt, changes = "1. Asked for an impact line.") {
  return `<analysis>\n- Output never names the impact.\n</analysis>\n\n<rewritten_prompt>\n${prompt}\n</rewritten_prompt>\n\n<changes>\n${changes}\n</changes>`;
}

/**
 * Answers refine generations from a queue of rewritten prompts, and evaluation prompts with an output that
 * passes the keyword check only when the candidate prompt contains "impact".
 */
class ScriptedAdapter {
  constructor(rewrites) {
    this.rewrites = [...rewrites];
    this.generations = [];
    this.evaluations = [];
  }
  async complete(request) {
    if (request.prompt.startsWith(REFINE_PROTOCOL)) {
      this.generations.push(request);
      const next = this.rewrites.shift();
      if (next === undefined) throw new Error("no scripted rewrite left");
      if (next instanceof Error) throw next;
      return { text: typeof next === "string" ? reply(next) : next.raw, latencyMs: 20, usage: { inputTokens: 100, outputTokens: 40 } };
    }
    this.evaluations.push(request);
    const mentionsImpact = request.prompt.includes("impact");
    return {
      text: mentionsImpact ? "Impact: three customers lost access for forty minutes." : "There was an outage.",
      latencyMs: 10,
      usage: { inputTokens: 50, outputTokens: 10 },
    };
  }
}

function evidence(overrides = {}) {
  return {
    caseId: "keyword",
    caseName: "Mentions impact",
    input: "Database outage <raw>",
    output: "There was an outage & nothing else.",
    failedChecks: [{ id: "required_keyword:impact", expected: "impact", actual: false }],
    passedCheckCount: 1,
    judge: { score: 0.33, rationale: "Vague; no impact stated." },
    ...overrides,
  };
}

test("buildRefinePrompt fences the prompt and escapes the evidence", () => {
  const prompt = buildRefinePrompt({
    prompt: "<task>\nUse ```js``` blocks.\n</task>",
    evidence: [evidence()],
    rejected: [{ round: 1, score: 0.5, changes: ["Added a role.", "Set a <strict> limit."] }],
  });
  assert.ok(prompt.startsWith(REFINE_PROTOCOL));
  assert.ok(prompt.includes("````\n<task>\nUse ```js``` blocks.\n</task>\n````"), "prompt is fenced past its own backticks, not escaped");
  assert.ok(prompt.includes('<case id="keyword" name="Mentions impact">'));
  assert.ok(prompt.includes("<input>\nDatabase outage &lt;raw&gt;\n</input>"));
  assert.ok(prompt.includes("<output>\nThere was an outage &amp; nothing else.\n</output>"));
  assert.ok(prompt.includes("- required_keyword:impact: expected &quot;impact&quot;, got false"));
  assert.ok(prompt.includes('<judge score="0.33">\nVague; no impact stated.\n</judge>'));
  assert.ok(prompt.includes("- Round 1, score 0.50: Added a role. Set a &lt;strict&gt; limit."));
});

test("buildRefinePrompt shows failing cases first and counts the ones that do not fit", () => {
  const passing = evidence({ caseId: "ok", caseName: "Passing", failedChecks: [], judge: null, output: "fine" });
  const big = Array.from({ length: 12 }, (_, index) => evidence({ caseId: `big${index}`, output: "x".repeat(1_400) }));
  const prompt = buildRefinePrompt({ prompt: START, evidence: [passing, ...big] });
  const firstCase = prompt.indexOf('<case id="');
  assert.ok(prompt.slice(firstCase).startsWith('<case id="big0"'), "a failing case comes before the passing one");
  assert.match(prompt, /<omitted_cases count="\d+">/u);
  const evidenceBlock = prompt.slice(prompt.indexOf("<evidence>"), prompt.indexOf("</evidence>"));
  assert.ok(evidenceBlock.length <= MAX_REFINE_EVIDENCE_CHARACTERS + 2_000, "evidence stays near the cap");
  assert.ok(prompt.includes("none (1 passed)") === false || prompt.includes('<case id="ok"'));
});

test("buildRefinePrompt rejects empty prompts and empty evidence", () => {
  assert.throws(() => buildRefinePrompt({ prompt: "  ", evidence: [evidence()] }), { code: "INVALID_CANDIDATE" });
  assert.throws(() => buildRefinePrompt({ prompt: START, evidence: [] }), { code: "INVALID_CANDIDATE" });
});

test("evidenceFromEvaluation pairs each case with its checks, judge, and captured output", async () => {
  const adapter = new ScriptedAdapter([]);
  const candidate = baselineCandidate(START);
  const evaluation = await evaluateCandidate(adapter, candidate, SUITE);
  const cases = evidenceFromEvaluation(SUITE, evaluation, { keyword: "There was an outage." });
  assert.equal(cases.length, 1);
  assert.equal(cases[0].input, SUITE.cases[0].input);
  assert.equal(cases[0].output, "There was an outage.");
  assert.deepEqual(cases[0].failedChecks.map((check) => check.id), ["required_keyword.0"]);
  assert.equal(cases[0].passedCheckCount, 1);
  assert.equal(cases[0].judge, null);
});

test("refinePrompt keeps a revision that scores better and stops once the score is perfect", async () => {
  const adapter = new ScriptedAdapter(["Summarize the incident for executives. State the customer impact in one line.", "Summarize for executives."]);
  const rounds = [];
  const result = await refinePrompt({ adapter, start: START, suite: SUITE, rounds: 3, variantsPerRound: 2, onRound: (round) => rounds.push(round) });

  assert.equal(result.stopReason, "perfect_score");
  assert.equal(result.rounds.length, 1);
  assert.equal(rounds.length, 1);
  assert.equal(result.candidates.length, 3, "start plus both evaluated revisions");
  assert.equal(result.candidates[0].id, result.startCandidateId);
  assert.ok(result.candidates[0].id.startsWith(`${REFINE_PATTERN}-r0-`));
  const best = result.candidates.find((candidate) => candidate.id === result.bestCandidateId);
  assert.ok(best.prompt.text.includes("impact"));
  assert.equal(best.parentCandidateId, result.startCandidateId);
  assert.deepEqual(best.metadata, { label: REFINE_PATTERN, round: 1, variant: 0 });
  assert.equal(result.rounds[0].improved, true);
  assert.equal(result.rounds[0].bestCandidateId, best.id);
  assert.deepEqual(result.rounds[0].attempts.map((attempt) => attempt.status), ["evaluated", "evaluated"]);
  assert.equal(result.ranking[0].candidateId, best.id);
  assert.equal(result.ranking[0].quality.combined.value, 1);
  // 1 start evaluation + 2 generations + 2 evaluations.
  assert.equal(result.completionsUsed, 5);
  assert.equal(adapter.generations.length, 2);
  assert.ok(adapter.generations.every((request) => request.temperature === DEFAULT_REFINE_TEMPERATURE));
  assert.ok(adapter.evaluations.every((request) => request.temperature === undefined), "evaluations keep the adapter's default temperature");
  assert.ok(adapter.generations[0].prompt.includes("<failed_checks>\n- required_keyword.0: expected &quot;impact&quot;, got false"), "the model sees the failed check");
  assert.ok(adapter.generations[0].prompt.includes("There was an outage."), "the model sees the actual output");
});

test("refinePrompt keeps the incumbent on a tie and lists the rejected revision in the next round", async () => {
  const adapter = new ScriptedAdapter(["Summarize for executives, briefly.", "Summarize the incident. Include the customer impact."]);
  const result = await refinePrompt({ adapter, start: START, suite: SUITE, rounds: 2, variantsPerRound: 1, temperature: 1.2 });
  assert.equal(result.rounds[0].improved, false);
  assert.equal(result.rounds[0].bestCandidateId, result.startCandidateId);
  assert.equal(result.rounds[1].improved, true);
  assert.equal(result.rounds[1].parentCandidateId, result.startCandidateId, "the second round refines the incumbent, not the rejected revision");
  assert.ok(adapter.generations[1].prompt.includes("<rejected_revisions>\n- Round 1, score 0.50: Asked for an impact line."));
  assert.ok(adapter.generations.every((request) => request.temperature === 1.2));
  assert.equal(result.bestCandidateId, result.rounds[1].bestCandidateId);
  assert.equal(result.stopReason, "rounds_exhausted", "the last round improved, so no later round observed the perfect score");
});

test("refinePrompt records duplicates, unparseable replies, and failed generations without stopping the round", async () => {
  const adapter = new ScriptedAdapter([START, { raw: "no sections here" }, new Error("provider down")]);
  const result = await refinePrompt({ adapter, start: START, suite: SUITE, rounds: 1, variantsPerRound: 3 });
  const statuses = result.rounds[0].attempts.map((attempt) => attempt.status).sort();
  assert.deepEqual(statuses, ["duplicate", "failed", "invalid"]);
  const duplicate = result.rounds[0].attempts.find((attempt) => attempt.status === "duplicate");
  assert.equal(duplicate.candidateId, result.startCandidateId);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rounds[0].improved, false);
  assert.equal(result.stopReason, "rounds_exhausted");
  assert.equal(result.completionsUsed, 4, "start evaluation plus three generations; nothing new was evaluated");
});

test("refinePrompt accepts a start candidate with its evaluation and skips the round-0 completions", async () => {
  const first = new ScriptedAdapter([]);
  const start = baselineCandidate(START);
  const evaluation = await evaluateCandidate(first, start, SUITE);
  const adapter = new ScriptedAdapter(["Summarize the incident for executives, naming the impact."]);
  const result = await refinePrompt({
    adapter,
    start,
    suite: SUITE,
    startEvaluation: { evaluation, outputs: { keyword: "There was an outage." } },
    rounds: 1,
    variantsPerRound: 1,
  });
  assert.equal(result.startCandidateId, start.id);
  assert.equal(result.evaluations[0], evaluation);
  assert.equal(adapter.evaluations.length, 1, "only the revision was evaluated");
  assert.equal(result.completionsUsed, 2);
  assert.ok(adapter.generations[0].prompt.includes("There was an outage."), "the supplied output is the evidence");
  assert.ok(result.rounds[0].improved);
});

test("refinePrompt rejects a start evaluation for a different candidate", async () => {
  const adapter = new ScriptedAdapter([]);
  const other = await evaluateCandidate(adapter, baselineCandidate("Other"), SUITE);
  await assert.rejects(
    refinePrompt({ adapter, start: baselineCandidate(START), suite: SUITE, startEvaluation: { evaluation: other, outputs: {} } }),
    { code: "INVALID_EVALUATION" },
  );
});

test("refinePrompt stops before a round that would exceed the completion budget", async () => {
  const adapter = new ScriptedAdapter(["Summarize for executives, noting the impact."]);
  const result = await refinePrompt({ adapter, start: START, suite: SUITE, rounds: 2, variantsPerRound: 2, maxCompletions: 4 });
  // Round 0 costs 1; a round of two variants costs 2 × (1 + 1) = 4, which does not fit in the remaining 3.
  assert.equal(result.stopReason, "budget_exhausted");
  assert.equal(result.rounds.length, 0);
  assert.equal(result.completionsUsed, 1);
});

test("refinePrompt validates its limits and temperature", async () => {
  const adapter = new ScriptedAdapter([]);
  await assert.rejects(refinePrompt({ adapter, start: START, suite: SUITE, rounds: 0 }), { code: "INVALID_OBJECTIVE" });
  await assert.rejects(refinePrompt({ adapter, start: START, suite: SUITE, variantsPerRound: 99 }), { code: "INVALID_OBJECTIVE" });
  await assert.rejects(refinePrompt({ adapter, start: START, suite: SUITE, temperature: 3 }), { code: "INVALID_EVALUATION" });
  await assert.rejects(refinePrompt({ adapter, start: START, suite: SUITE, extra: true }), { code: "INVALID_CANDIDATE" });
});

test("refinePrompt rethrows cancellation", async () => {
  const controller = new AbortController();
  const adapter = {
    async complete() {
      controller.abort();
      throw new CompletionCancelledError("cancelled");
    },
  };
  await assert.rejects(refinePrompt({ adapter, start: START, suite: SUITE, signal: controller.signal }), CompletionCancelledError);
});

test("refineCandidate ids are stable for the same parent and text", () => {
  const parent = baselineCandidate(START);
  const left = refineCandidate(parent, 2, 1, "revised");
  const right = refineCandidate(parent, 2, 1, "revised");
  assert.equal(left.id, right.id);
  assert.ok(left.id.startsWith(`${REFINE_PATTERN}-r2-v1-`));
  assert.equal(left.parentCandidateId, parent.id);
  assert.notEqual(left.id, refineCandidate(parent, 2, 1, "other").id);
});
