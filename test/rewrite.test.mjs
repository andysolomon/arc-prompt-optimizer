import assert from "node:assert/strict";
import test from "node:test";

import {
  CompletionCancelledError,
  MAX_REWRITE_DRAFT_CHARACTERS,
  MAX_REWRITE_INPUT_CHARACTERS,
  PREVIEW_SUITE,
  REVISE_FORMAT_REMINDER,
  REVISE_PROTOCOL,
  REWRITE_FORMAT_REMINDER,
  REWRITE_PROTOCOL,
  baselineCandidate,
  buildPreviewCandidates,
  buildRevisePrompt,
  buildRewritePrompt,
  evaluateSuite,
  parseRewriteOutput,
  revisePrompt,
  revisionCandidate,
  rewriteCandidate,
  rewritePrompt,
} from "../dist/core/index.js";

const DRAFT = "Summarize this incident report for executives.";

function reply(prompt, { analysis = "- No audience detail.", changes = "1. Added a role." } = {}) {
  return `<analysis>\n${analysis}\n</analysis>\n\n<rewritten_prompt>\n${prompt}\n</rewritten_prompt>\n\n<changes>\n${changes}\n</changes>`;
}

class ScriptedAdapter {
  constructor(text, extra = {}) {
    this.text = text;
    this.extra = extra;
    this.requests = [];
  }
  async complete(request) {
    this.requests.push(request);
    return { text: this.text, ...this.extra };
  }
}

test("buildRewritePrompt appends the draft in a fence after the protocol", () => {
  const prompt = buildRewritePrompt(DRAFT);
  assert.ok(prompt.startsWith(REWRITE_PROTOCOL));
  assert.ok(prompt.endsWith("```\n" + DRAFT + "\n```"));
});

test("buildRewritePrompt keeps XML in the draft and fences past any backticks inside it", () => {
  const draft = "<task>\nUse ```js``` blocks and ````md```` too.\n</task>";
  const prompt = buildRewritePrompt(draft);
  assert.ok(prompt.includes(draft), "draft is not entity-escaped");
  assert.ok(prompt.endsWith("`````\n" + draft + "\n`````"));
});

test("buildRewritePrompt appends fenced task context and target use case only when given", () => {
  const plain = buildRewritePrompt(DRAFT);
  assert.ok(!plain.includes("Task context:"));
  assert.ok(!plain.includes("Target use case:"));
  assert.equal(buildRewritePrompt(DRAFT, { context: "  ", useCase: "" }), plain, "blank inputs are omitted");

  const both = buildRewritePrompt(DRAFT, { context: "Reports come from PagerDuty as `markdown`.", useCase: " Weekly exec email " });
  assert.ok(both.startsWith(plain));
  assert.ok(both.includes("\n\nTask context:\n```\nReports come from PagerDuty as `markdown`.\n```"));
  assert.ok(both.endsWith("\n\nTarget use case:\n```\nWeekly exec email\n```"), "inputs are trimmed and the use case comes last");
  assert.ok(buildRewritePrompt(DRAFT, { context: "```\ncode\n```" }).includes("````\n```\ncode\n```\n````"), "context fences past its own backticks");

  const onlyUseCase = buildRewritePrompt(DRAFT, { useCase: "Chatbot" });
  assert.ok(!onlyUseCase.includes("Task context:"));
  assert.ok(onlyUseCase.endsWith("Target use case:\n```\nChatbot\n```"));
});

test("buildRewritePrompt rejects malformed and oversized context or use case", () => {
  assert.throws(() => buildRewritePrompt(DRAFT, { context: 42 }), { code: "INVALID_CANDIDATE" });
  assert.throws(() => buildRewritePrompt(DRAFT, { useCase: "x".repeat(MAX_REWRITE_INPUT_CHARACTERS + 1) }), { code: "INPUT_TOO_LARGE" });
  assert.ok(buildRewritePrompt(DRAFT, { context: "x".repeat(MAX_REWRITE_INPUT_CHARACTERS) }).includes("x".repeat(MAX_REWRITE_INPUT_CHARACTERS)));
});

test("buildRewritePrompt rejects empty and oversized drafts", () => {
  assert.throws(() => buildRewritePrompt("   "), { code: "INVALID_CANDIDATE" });
  assert.throws(() => buildRewritePrompt("x".repeat(MAX_REWRITE_DRAFT_CHARACTERS + 1)), { code: "INPUT_TOO_LARGE" });
});

test("parseRewriteOutput extracts the prompt, analysis, and changes", () => {
  const parsed = parseRewriteOutput(
    reply("You are an incident analyst.\n\n<report>\n...\n</report>", {
      analysis: "- Vague audience.\n- No length\n  or format.",
      changes: "1. Added a role.\n2) Set a 150-word limit.\n* Added XML delimiters.",
    }),
  );
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.rewrittenPrompt, "You are an incident analyst.\n\n<report>\n...\n</report>");
  assert.deepEqual(parsed.analysis, ["Vague audience.", "No length or format."]);
  assert.deepEqual(parsed.changes, ["Added a role.", "Set a 150-word limit.", "Added XML delimiters."]);
});

test("parseRewriteOutput drops a heading before the list and strips markdown emphasis", () => {
  const parsed = parseRewriteOutput(
    reply("P", {
      analysis: "Weaknesses found in the draft prompt:\n- **Vagueness**: no depth.\n- __No role__.",
      changes: "Plain sentence without a list.",
    }),
  );
  assert.deepEqual(parsed.analysis, ["Vagueness: no depth.", "No role."]);
  assert.deepEqual(parsed.changes, ["Plain sentence without a list."]);
});

test("parseRewriteOutput uses the last complete section and ignores reasoning that mentions the tags", () => {
  const text = `<think>I will write <rewritten_prompt>draft idea</rewritten_prompt> first.</think>\n${reply("Final prompt.")}`;
  const parsed = parseRewriteOutput(text);
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.rewrittenPrompt, "Final prompt.");
});

test("parseRewriteOutput unwraps a fence around the whole prompt", () => {
  const parsed = parseRewriteOutput(reply("```text\nYou are an analyst.\n```"));
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.rewrittenPrompt, "You are an analyst.");
});

test("parseRewriteOutput reports a missing, unterminated, or empty prompt instead of guessing", () => {
  assert.equal(parseRewriteOutput("Here is a better prompt: be specific.").status, "invalid");
  assert.equal(parseRewriteOutput("<rewritten_prompt>\nTruncated mid-sentence").status, "invalid");
  assert.equal(parseRewriteOutput(reply("   ")).status, "invalid");
});

test("parseRewriteOutput caps notes", () => {
  const many = Array.from({ length: 40 }, (_, index) => `- note ${index}`).join("\n");
  const long = `- ${"x".repeat(900)}`;
  const parsed = parseRewriteOutput(reply("P", { analysis: many, changes: long }));
  assert.equal(parsed.analysis.length, 32);
  assert.equal(parsed.changes[0].length, 500);
});

test("rewriteCandidate is an explicit generation that points at the baseline", () => {
  const candidate = rewriteCandidate(DRAFT, "You are an analyst.");
  assert.match(candidate.id, /^rewrite-[0-9a-f]{8}$/u);
  assert.equal(candidate.origin, "explicit_generation");
  assert.equal(candidate.parentCandidateId, baselineCandidate(DRAFT).id);
  assert.deepEqual(candidate.prompt, { pattern: "rewrite", text: "You are an analyst.", variablesUsed: [] });
  assert.deepEqual(candidate.metadata, { label: "rewrite" });
  assert.equal(rewriteCandidate(DRAFT, "You are an analyst.").id, candidate.id, "ids are deterministic");
  assert.notEqual(rewriteCandidate(DRAFT, "Other.").id, candidate.id);
});

test("rewritePrompt makes one completion and returns a candidate the evaluator accepts", async () => {
  const adapter = new ScriptedAdapter(reply("You are an incident analyst. Summarize in 5 bullets."), {
    latencyMs: 120,
    usage: { inputTokens: 900, outputTokens: 300 },
  });
  const outcome = await rewritePrompt(adapter, DRAFT, { model: "test/model", timeoutMs: 1_000, context: "Reports are markdown.", useCase: "Exec email" });
  assert.equal(outcome.status, "rewritten");
  assert.equal(adapter.requests.length, 1);
  assert.equal(adapter.requests[0].model, "test/model");
  assert.ok(adapter.requests[0].prompt.includes(DRAFT));
  assert.equal(adapter.requests[0].prompt, buildRewritePrompt(DRAFT, { context: "Reports are markdown.", useCase: "Exec email" }));
  assert.deepEqual(outcome.measurements.totalTokens, { status: "measured", value: 1_200 });
  assert.deepEqual(outcome.changes, ["Added a role."]);

  const candidates = [...buildPreviewCandidates(DRAFT), outcome.candidate];
  const runner = new ScriptedAdapter("An output.");
  const evaluation = await evaluateSuite(runner, candidates, PREVIEW_SUITE);
  assert.equal(evaluation.candidates.length, 5);
  assert.equal(runner.requests.at(-1).prompt, "You are an incident analyst. Summarize in 5 bullets.");
});

test("rewritePrompt retries once with a format reminder and reports a still-unparseable reply with its measurements", async () => {
  const adapter = new ScriptedAdapter("No tags here.", { latencyMs: 5 });
  const outcome = await rewritePrompt(adapter, DRAFT);
  assert.equal(outcome.status, "invalid");
  assert.equal(outcome.attempts, 2);
  assert.equal(adapter.requests.length, 2);
  assert.ok(!adapter.requests[0].prompt.startsWith(REWRITE_FORMAT_REMINDER), "first attempt carries no reminder");
  assert.ok(adapter.requests[1].prompt.startsWith(REWRITE_FORMAT_REMINDER), "retry starts with the reminder");
  assert.ok(adapter.requests[1].prompt.endsWith("```\n" + DRAFT + "\n```"));
  assert.match(outcome.reason, /rewritten_prompt/u);
  assert.deepEqual(outcome.measurements.latencyMs, { status: "measured", value: 5 });
  const single = new ScriptedAdapter("No tags here.");
  assert.equal((await rewritePrompt(single, DRAFT, { maxAttempts: 1 })).attempts, 1);
  assert.equal(single.requests.length, 1);
});

test("rewritePrompt caps all attempts by totalTimeoutMs and skips a retry that would not fit", async () => {
  const slowGarbage = {
    requests: [],
    async complete(request) {
      this.requests.push(request);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { text: "garbage" };
    },
  };
  const outcome = await rewritePrompt(slowGarbage, DRAFT, { timeoutMs: 1_000, totalTimeoutMs: 40 });
  assert.equal(outcome.status, "invalid");
  assert.equal(outcome.attempts, 1, "the retry is skipped when under MIN_RETRY_TIMEOUT_MS remains");
  assert.equal(slowGarbage.requests.length, 1);
  await assert.rejects(rewritePrompt(slowGarbage, DRAFT, { totalTimeoutMs: 0 }), { code: "INVALID_CANDIDATE" });
});

test("rewritePrompt succeeds on the retry when the first reply is malformed", async () => {
  let calls = 0;
  const adapter = {
    requests: [],
    async complete(request) {
      this.requests.push(request);
      calls += 1;
      return { text: calls === 1 ? "Sure! Here is a better prompt." : reply("You are an analyst.") };
    },
  };
  const outcome = await rewritePrompt(adapter, DRAFT);
  assert.equal(outcome.status, "rewritten");
  assert.equal(outcome.attempts, 2);
  assert.equal(outcome.candidate.prompt.text, "You are an analyst.");
});

test("parseRewriteOutput accepts markdown headings in place of the tags", () => {
  const text = [
    "## Analysis",
    "- No role.",
    "- No format.",
    "",
    "## Rewritten Prompt",
    "You are a coach.",
    "",
    "Review the app. Changes to the roster are out of scope.",
    "",
    "**Changes:**",
    "1. Added a role.",
    "",
    "### Plan",
    "```json",
    '{"task_type": "analysis-review", "temperature": 0.3, "criteria": {"max_words": 400, "required_keywords": ["roster"]}}',
    "```",
  ].join("\n");
  const parsed = parseRewriteOutput(text);
  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.rewrittenPrompt, "You are a coach.\n\nReview the app. Changes to the roster are out of scope.");
  assert.deepEqual(parsed.analysis, ["No role.", "No format."]);
  assert.deepEqual(parsed.changes, ["Added a role."]);
  assert.equal(parsed.plan.taskType, "analysis_review");
  assert.equal(parsed.plan.temperature, 0.3);
  assert.deepEqual(parsed.plan.criteria, { maxWords: 400, requiredKeywords: ["roster"], forbiddenPhrases: [] });
});

test("parseRewriteOutput names the output limit when the reply was cut off", () => {
  const cut = parseRewriteOutput("<analysis>\n- x\n</analysis>\n<rewritten_prompt>\nYou are", { finishReason: "length" });
  assert.equal(cut.status, "invalid");
  assert.match(cut.reason, /never closes it \(the reply was cut off at the output limit\)/u);
  const early = parseRewriteOutput("<analysis>\n- x\n- y", { finishReason: "length" });
  assert.match(early.reason, /cut off at the output limit before any/u);
  assert.equal(parseRewriteOutput("   ").reason, "rewrite reply is empty");
});

test("parseRewriteOutput carries the plan from a tagged reply and tolerates a missing or broken one", () => {
  const withPlan = parseRewriteOutput(
    reply("P") +
      "\n<plan>\n" +
      JSON.stringify({
        task_type: "summarization",
        temperature: "0.3",
        criteria: { max_words: 150, expected_format: "bullet points", required_keywords: ["revenue", " Revenue ", ""], forbidden_phrases: ["as an AI"] },
        patterns: [
          { pattern: "persona", variables: { role: "a CFO", experience: "10 years", style: "terse", priority: "accuracy" } },
          { pattern: "chain_of_thought" },
          { pattern: "guardrail", variables: { role: "x" } },
          { pattern: "bogus" },
        ],
      }) +
      "\n</plan>",
  );
  assert.equal(withPlan.status, "parsed");
  assert.deepEqual(withPlan.plan, {
    taskType: "summarization",
    temperature: 0.3,
    criteria: { expectedFormat: "bullet_list", maxWords: 150, requiredKeywords: ["revenue"], forbiddenPhrases: ["as an AI"] },
    patterns: [
      { pattern: "persona", variables: { role: "a CFO", experience: "10 years", style: "terse", priority: "accuracy" } },
      { pattern: "chain_of_thought", variables: {} },
    ],
  });
  assert.equal(parseRewriteOutput(reply("P")).plan, undefined);
  assert.equal(parseRewriteOutput(reply("P") + "\n<plan>\nnot json\n</plan>").plan, undefined);
  const empty = parseRewriteOutput(reply("P") + "\n<plan>\n{}\n</plan>").plan;
  assert.deepEqual(empty, { taskType: "other", criteria: { requiredKeywords: [], forbiddenPhrases: [] }, patterns: [] });
});

test("buildRewritePrompt lists every catalog pattern with its variables for the plan", () => {
  const prompt = buildRewritePrompt(DRAFT);
  assert.ok(prompt.includes("- persona:"), "persona is listed");
  assert.ok(prompt.includes("Variables: role, experience, style, priority."), "task variable is omitted from persona");
  assert.ok(prompt.includes("- chain_of_thought:"), "chain_of_thought is listed");
  assert.ok(!prompt.includes("Variables: problem"), "task-only patterns list no variables");
  assert.ok(prompt.includes("analysis_review"), "task types are listed");
});

test("revisionCandidate points at its parent and carries the round", () => {
  const parent = rewriteCandidate(DRAFT, "You are an analyst.");
  const revision = revisionCandidate(parent, "You are an analyst. Use at most 100 words.", 2);
  assert.match(revision.id, /^rewrite-v2-[0-9a-f]{8}$/u);
  assert.equal(revision.parentCandidateId, parent.id);
  assert.deepEqual(revision.metadata, { label: "rewrite_v2", revision: 2 });
  assert.equal(revision.prompt.pattern, "rewrite");
  assert.throws(() => revisionCandidate(parent, "x", 1), { code: "INVALID_CANDIDATE" });
});

test("buildRevisePrompt names the failed checks and fences the draft, prompt, and output", () => {
  const prompt = buildRevisePrompt({
    draft: DRAFT,
    prompt: "You are an analyst.",
    output: "A ".repeat(1_000),
    failedChecks: [{ criterion: "max_words", expected: 100, actual: 1_000 }],
  });
  assert.ok(prompt.startsWith(REVISE_PROTOCOL));
  assert.ok(prompt.includes('- max_words: expected 100, got 1000'));
  assert.ok(prompt.includes("```\n" + DRAFT + "\n```"));
  assert.ok(prompt.includes("```\nYou are an analyst.\n```"));
  assert.ok(prompt.includes("(beginning only)"));
  assert.ok(prompt.length < REVISE_PROTOCOL.length + 2_200, "output excerpt is bounded");
  assert.throws(() => buildRevisePrompt({ draft: DRAFT, prompt: "p", output: "", failedChecks: [] }), { code: "INVALID_CANDIDATE" });
});

test("revisePrompt sends only the failed checks and returns a revision of the candidate", async () => {
  const parent = rewriteCandidate(DRAFT, "You are an analyst.");
  const adapter = new ScriptedAdapter(reply("You are an analyst. Reply in at most 100 words.", { changes: "1. Added a word limit." }));
  const outcome = await revisePrompt(adapter, {
    draft: DRAFT,
    candidate: parent,
    round: 2,
    output: "long output",
    checks: [
      { id: "max_words", criterion: "max_words", weight: 1, passed: false, expected: 100, actual: 180 },
      { id: "format", criterion: "format", weight: 1, passed: true, expected: "bullet_list", actual: true },
    ],
  });
  assert.equal(outcome.status, "rewritten");
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.candidate.parentCandidateId, parent.id);
  assert.equal(outcome.candidate.metadata.revision, 2);
  assert.deepEqual(outcome.changes, ["Added a word limit."]);
  assert.ok(adapter.requests[0].prompt.includes("max_words"));
  assert.ok(!adapter.requests[0].prompt.includes("bullet_list"), "passed checks are not sent");
  const retrying = new ScriptedAdapter("nope");
  const invalid = await revisePrompt(retrying, { draft: DRAFT, candidate: parent, round: 2, output: "", checks: [{ id: "max_words", criterion: "max_words", weight: 1, passed: false, expected: 1, actual: 2 }] });
  assert.equal(invalid.status, "invalid");
  assert.ok(retrying.requests[1].prompt.startsWith(REVISE_FORMAT_REMINDER));
});

test("rewritePrompt reports adapter errors and timeouts as failures", async () => {
  const failing = { complete: async () => Promise.reject(new Error("provider down")) };
  assert.deepEqual(await rewritePrompt(failing, DRAFT), { status: "failed", reason: "provider down", attempts: 1 });
  const slow = { complete: () => new Promise((resolve) => setTimeout(() => resolve({ text: reply("late") }), 200)) };
  const timedOut = await rewritePrompt(slow, DRAFT, { timeoutMs: 10 });
  assert.equal(timedOut.status, "failed");
  assert.match(timedOut.reason, /timed out/u);
});

test("rewritePrompt rethrows cancellation so the caller's run stops", async () => {
  const controller = new AbortController();
  const hanging = { complete: () => new Promise(() => {}) };
  const pending = rewritePrompt(hanging, DRAFT, { signal: controller.signal, timeoutMs: 5_000 });
  controller.abort();
  await assert.rejects(pending, CompletionCancelledError);
  await assert.rejects(rewritePrompt(hanging, DRAFT, { signal: controller.signal }), CompletionCancelledError);
});
