import assert from "node:assert/strict";
import test from "node:test";

import {
  CompletionCancelledError,
  MAX_REWRITE_DRAFT_CHARACTERS,
  PREVIEW_SUITE,
  REWRITE_PROTOCOL,
  baselineCandidate,
  buildPreviewCandidates,
  buildRewritePrompt,
  evaluateSuite,
  parseRewriteOutput,
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
  const outcome = await rewritePrompt(adapter, DRAFT, { model: "test/model", timeoutMs: 1_000 });
  assert.equal(outcome.status, "rewritten");
  assert.equal(adapter.requests.length, 1);
  assert.equal(adapter.requests[0].model, "test/model");
  assert.ok(adapter.requests[0].prompt.includes(DRAFT));
  assert.deepEqual(outcome.measurements.totalTokens, { status: "measured", value: 1_200 });
  assert.deepEqual(outcome.changes, ["Added a role."]);

  const candidates = [...buildPreviewCandidates(DRAFT), outcome.candidate];
  const runner = new ScriptedAdapter("An output.");
  const evaluation = await evaluateSuite(runner, candidates, PREVIEW_SUITE);
  assert.equal(evaluation.candidates.length, 5);
  assert.equal(runner.requests.at(-1).prompt, "You are an incident analyst. Summarize in 5 bullets.");
});

test("rewritePrompt reports an unparseable reply with its measurements", async () => {
  const outcome = await rewritePrompt(new ScriptedAdapter("No tags here.", { latencyMs: 5 }), DRAFT);
  assert.equal(outcome.status, "invalid");
  assert.match(outcome.reason, /rewritten_prompt/u);
  assert.deepEqual(outcome.measurements.latencyMs, { status: "measured", value: 5 });
});

test("rewritePrompt reports adapter errors and timeouts as failures", async () => {
  const failing = { complete: async () => Promise.reject(new Error("provider down")) };
  assert.deepEqual(await rewritePrompt(failing, DRAFT), { status: "failed", reason: "provider down" });
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
