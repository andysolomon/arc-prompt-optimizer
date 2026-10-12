import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MAX_CLI_PROMPT_CHARACTERS } from "../dist/cli/io.js";
import { runCli } from "../dist/cli/main.js";
import {
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_EVALUATION_CANDIDATES,
  MAX_REWRITE_INPUT_CHARACTERS,
  PREVIEW_SUITE as CORE_PREVIEW_SUITE,
  buildRewritePrompt,
  rewriteCandidate,
} from "../dist/core/index.js";
import { PREVIEW_SUITE, buildPreviewCandidates } from "../dist/extension/run.js";

const rootPath = new URL("../", import.meta.url).pathname;

class FakeStdin {
  constructor(text = "", isTTY = true) {
    this.text = text;
    this.isTTY = isTTY;
    this.handlers = { data: [], end: [], error: [] };
  }

  setEncoding() {}

  on(event, listener) {
    this.handlers[event].push(listener);
    if (event === "end") {
      queueMicrotask(() => {
        for (const handler of this.handlers.data) handler(this.text);
        for (const handler of this.handlers.end) handler();
      });
    }
    return this;
  }
}

class FakeWritable {
  constructor() {
    this.text = "";
  }

  write(text, callback) {
    this.text += text;
    callback?.();
    return true;
  }
}

async function run(args, options = {}) {
  const stdout = new FakeWritable();
  const stderr = new FakeWritable();
  const stdin = options.stdin === undefined ? new FakeStdin("", true) : new FakeStdin(options.stdin, false);
  const code = await runCli({ argv: args, io: { stdin, stdout, stderr, cwd: options.cwd ?? rootPath } });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "arc-prompt-harness-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PROMPT = "Summarize the release notes.";

function previewOutputs(texts, measurements = {}) {
  return {
    candidates: buildPreviewCandidates(PROMPT).map((candidate, index) => ({
      id: candidate.id,
      outputs: { preview: texts[index] },
      ...(measurements[index] === undefined ? {} : { measurements: { preview: measurements[index] } }),
    })),
  };
}

async function weightedSuite(dir) {
  const suites = JSON.parse(await readFile(new URL("../fixtures/weighted-suites.json", import.meta.url), "utf8"));
  const path = join(dir, "suite.json");
  await writeFile(path, JSON.stringify(suites[0]), "utf8");
  return path;
}

test("help lists candidates and score and documents the preview case id", async () => {
  const top = await run(["--help"]);
  assert.equal(top.code, 0);
  assert.ok(top.stdout.includes("candidates"));
  assert.ok(top.stdout.includes("score"));
  assert.ok(top.stdout.includes("rewrite-prompt"));
  assert.ok(top.stdout.includes("rewrite-candidate"));
  const rewritePrompt = await run(["rewrite-prompt", "--help"]);
  assert.match(rewritePrompt.stdout, /^Usage: arc-prompt rewrite-prompt/u);
  assert.ok(rewritePrompt.stdout.includes("--use-case-file"));
  const rewriteCandidateHelp = await run(["rewrite-candidate", "--help"]);
  assert.match(rewriteCandidateHelp.stdout, /^Usage: arc-prompt rewrite-candidate/u);
  assert.ok(rewriteCandidateHelp.stdout.includes("INVALID_REWRITE_REPLY"));
  const candidates = await run(["candidates", "--help"]);
  assert.match(candidates.stdout, /^Usage: arc-prompt candidates/u);
  const score = await run(["score", "--help"]);
  assert.match(score.stdout, /^Usage: arc-prompt score/u);
  assert.ok(score.stdout.includes("'preview'"));
  assert.ok(score.stdout.includes("--outputs"));
});

test("preview candidate set lives in core and is re-exported identically by the extension", () => {
  assert.equal(PREVIEW_SUITE, CORE_PREVIEW_SUITE);
  assert.equal(PREVIEW_SUITE.cases[0].id, "preview");
});

test("candidates --json prints stable ids equal to the extension preview candidates", async () => {
  const first = await run(["candidates", "--prompt", PROMPT, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, "");
  const payload = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(payload), ["candidates"]);
  const expected = buildPreviewCandidates(PROMPT);
  assert.deepEqual(
    payload.candidates,
    expected.map((candidate) => ({ id: candidate.id, pattern: candidate.prompt.pattern, prompt: candidate.prompt.text })),
  );
  assert.deepEqual(payload.candidates.map((candidate) => candidate.pattern), ["baseline", "critique", "decomposition", "chain_of_thought"]);
  for (const candidate of payload.candidates) assert.deepEqual(Object.keys(candidate), ["id", "pattern", "prompt"]);

  const second = await run(["candidates", "--json"], { stdin: PROMPT });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
});

test("candidates human output lists every candidate id and prompt", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "prompt.txt");
    await writeFile(path, PROMPT, "utf8");
    const result = await run(["candidates", "--prompt-file", path]);
    assert.equal(result.code, 0, result.stderr);
    for (const candidate of buildPreviewCandidates(PROMPT)) {
      assert.ok(result.stdout.includes(`== ${candidate.id} (`));
      assert.ok(result.stdout.includes(candidate.prompt.text));
    }
  });
});

test("candidates rejects ambiguous, missing, oversized input and unsupported flags", async () => {
  const ambiguous = await run(["candidates", "--prompt", PROMPT], { stdin: "other" });
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.stderr, /^AMBIGUOUS_INPUT:/u);
  const missing = await run(["candidates"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^MISSING_INPUT:/u);
  const oversized = await run(["candidates", "--prompt", "x".repeat(MAX_CLI_PROMPT_CHARACTERS + 1)]);
  assert.equal(oversized.code, 2);
  assert.match(oversized.stderr, /^INPUT_TOO_LARGE:/u);
  const unsupported = await run(["candidates", "--prompt", PROMPT, "--simulate"]);
  assert.equal(unsupported.code, 2);
  assert.match(unsupported.stderr, /not supported by 'candidates'/u);
  const unsupportedScore = await run(["score", "--model", "x"]);
  assert.equal(unsupportedScore.code, 2);
  assert.match(unsupportedScore.stderr, /not supported by 'score'/u);
});

test("score with the preview suite ranks non-empty outputs above empty ones", async () => {
  const candidates = buildPreviewCandidates(PROMPT);
  const result = await run(["score", "--json"], { stdin: JSON.stringify(previewOutputs(["ok", "", "fine", "good"])) });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.suiteId, "prompt-optimize-preview");
  assert.deepEqual(Object.keys(payload), ["evaluations", "objective", "ranking", "suiteId"]);
  assert.equal(payload.ranking.at(-1).candidateId, candidates[1].id);
  assert.equal(payload.ranking.at(-1).rank, 4);
  assert.deepEqual(payload.ranking.slice(0, 3).map((entry) => entry.rank), [1, 1, 1]);
  const evaluation = payload.evaluations.find((entry) => entry.candidateId === candidates[1].id);
  assert.equal(evaluation.cases[0].deterministic.passed, false);
  assert.ok(Array.isArray(evaluation.cases[0].deterministic.checks));
  assert.equal(evaluation.cases[0].judge.status, "not_requested");

  const human = await run(["score"], { stdin: JSON.stringify(previewOutputs(["ok", "", "fine", "good"])) });
  assert.equal(human.code, 0, human.stderr);
  assert.ok(human.stdout.includes("Ranking"));
  assert.ok(human.stdout.includes(candidates[1].id));
});

test("score reports missing measurements as unknown and uses provided ones as tie-breakers", async () => {
  const candidates = buildPreviewCandidates(PROMPT);
  const outputs = previewOutputs(["a", "b", "c", "d"], {
    2: { latencyMs: 50, inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
    3: { latencyMs: 50, inputTokens: 20, outputTokens: 5 },
  });
  const result = await run(["score", "--json"], { stdin: JSON.stringify(outputs) });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.ranking.map((entry) => entry.candidateId),
    [candidates[2].id, candidates[3].id, candidates[0].id, candidates[1].id],
  );
  assert.equal(payload.ranking[1].tieBrokenBy, "totalTokens");
  const baseline = payload.evaluations.find((entry) => entry.candidateId === candidates[0].id);
  assert.equal(baseline.aggregate.latencyMs.status, "unknown");
  assert.equal(baseline.aggregate.totalTokens.status, "unknown");
  assert.equal(baseline.aggregate.costUsd.status, "unknown");
  const measuredEntry = payload.evaluations.find((entry) => entry.candidateId === candidates[2].id);
  assert.deepEqual(measuredEntry.aggregate.totalTokens, { status: "measured", value: 15 });
  assert.deepEqual(measuredEntry.aggregate.costUsd, { status: "measured", value: 0.01 });
  const partial = payload.evaluations.find((entry) => entry.candidateId === candidates[3].id);
  assert.equal(partial.aggregate.costUsd.status, "unknown");
});

test("score with a weighted suite file evaluates every case and ranks by deterministic score", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await weightedSuite(dir);
    const outputsPath = join(dir, "outputs.json");
    await writeFile(
      outputsPath,
      JSON.stringify({
        candidates: [
          { id: "weak", prompt: "weak prompt", outputs: { "profile-shape": "sorry, no", "release-list": "sorry" } },
          {
            id: "strong",
            outputs: { "profile-shape": '{"name":"Ada","role":"engineer","active":true}', "release-list": "- one\n- two" },
          },
        ],
      }),
      "utf8",
    );
    const result = await run(["score", "--suite", suitePath, "--outputs", outputsPath, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.suiteId, "weighted-engine");
    assert.deepEqual(payload.ranking.map((entry) => entry.candidateId), ["strong", "weak"]);
    const strong = payload.evaluations.find((entry) => entry.candidateId === "strong");
    assert.equal(strong.aggregate.caseCount, 2);
    assert.equal(strong.aggregate.passedCaseCount, 2);
    assert.deepEqual(strong.cases.map((entry) => entry.caseId), ["profile-shape", "release-list"]);
    assert.equal(result.stdout.includes("weak prompt"), false);

    const ambiguous = await run(["score", "--suite", suitePath, "--outputs", outputsPath], { stdin: "{}" });
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /^AMBIGUOUS_INPUT:/u);
  });
});

test("score rejects missing outputs, unknown keys, invalid measurements, and over-limit input", async () => {
  const candidates = buildPreviewCandidates(PROMPT);
  const cases = [
    { input: undefined, pattern: /^MISSING_INPUT:/u },
    { input: "not json", pattern: /^INVALID_JSON:/u },
    { input: { candidates: [] }, pattern: /at least one candidate/u },
    {
      input: { candidates: [{ id: candidates[0].id, outputs: {} }] },
      pattern: new RegExp(`Candidate '${candidates[0].id}' is missing an output for case 'preview'`, "u"),
    },
    { input: { candidates: [{ id: "a", outputs: { preview: "x" }, extra: true }] }, pattern: /unknown field\(s\): extra/u },
    { input: { candidates: [{ id: "a", outputs: { preview: "x", other: "y" } }] }, pattern: /unknown field\(s\): other/u },
    { input: { candidates: [], suite: "x" }, pattern: /unknown field\(s\): suite/u },
    {
      input: { candidates: [{ id: "a", outputs: { preview: "x" }, measurements: { preview: { latencyMs: 1, model: "m" } } }] },
      pattern: /unknown field\(s\): model/u,
    },
    {
      input: { candidates: [{ id: "a", outputs: { preview: "x" }, measurements: { preview: { latencyMs: -1 } } }] },
      pattern: /'latencyMs' must be a non-negative/u,
    },
    { input: { candidates: [{ id: "a", outputs: { preview: 3 } }] }, pattern: /must be a string/u },
    {
      input: { candidates: [{ id: "a", outputs: { preview: "x" } }, { id: "a", outputs: { preview: "y" } }] },
      pattern: /'a' is duplicated/u,
    },
    {
      input: { candidates: [{ id: "a", outputs: { preview: "x".repeat(MAX_COMPLETION_OUTPUT_CHARACTERS + 1) } }] },
      pattern: /^OUTPUT_TOO_LARGE:/u,
    },
    {
      input: {
        candidates: Array.from({ length: MAX_EVALUATION_CANDIDATES + 1 }, (_, index) => ({ id: `c${index}`, outputs: { preview: "x" } })),
      },
      pattern: /^BUDGET_EXCEEDED:/u,
    },
  ];
  for (const { input, pattern } of cases) {
    const stdin = input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input);
    const result = await run(["score"], stdin === undefined ? {} : { stdin });
    assert.equal(result.code, 2, `${stdin?.slice(0, 80)}: ${result.stderr}`);
    assert.match(result.stderr, pattern);
    assert.equal(result.stdout, "");
  }
});

test("candidates and score never load @earendil-works packages", async () => {
  for (const file of ["dist/cli/harness.js", "dist/core/preview.js"]) {
    const source = await readFile(join(rootPath, file), "utf8");
    assert.equal(source.includes("@earendil-works"), false, file);
    assert.equal(/pi-completion|cli\/adapters|\.\/adapters\.js/u.test(source), false, file);
  }

  const hook = `export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@earendil-works/")) throw new Error("PI_LOADED:" + specifier);
    return next(specifier, context);
  }`;
  const register = `import { register } from "node:module"; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hook)}`)});`;
  const importFlag = `data:text/javascript,${encodeURIComponent(register)}`;
  const bin = join(rootPath, "bin/arc-prompt");
  const exec = (args, input) =>
    new Promise((resolvePromise) => {
      const child = execFile(process.execPath, ["--import", importFlag, bin, ...args], { cwd: rootPath }, (error, stdout, stderr) =>
        resolvePromise({ code: error?.code ?? 0, stdout, stderr }),
      );
      child.stdin.end(input ?? "");
    });

  const candidates = await exec(["candidates", "--prompt", PROMPT, "--json"]);
  assert.equal(candidates.code, 0, candidates.stderr);
  const ids = JSON.parse(candidates.stdout).candidates.map((candidate) => candidate.id);
  const score = await exec(
    ["score", "--json"],
    JSON.stringify({ candidates: ids.map((id) => ({ id, outputs: { preview: "ok" } })) }),
  );
  assert.equal(score.code, 0, score.stderr);
  assert.equal(JSON.parse(score.stdout).ranking.length, 4);

  // The hook is effective: the live Pi models path trips it.
  const models = await exec(["models"]);
  assert.notEqual(models.code, 0);
  assert.match(models.stderr, /PI_LOADED:@earendil-works\//u);
});

const REPLY = "<analysis>\n- No audience.\n</analysis>\n\n<rewritten_prompt>\nYou are a release manager.\n\n<notes>\n[paste the release notes]\n</notes>\n\nSummarize them in 3 bullets.\n</rewritten_prompt>\n\n<changes>\n1. Added a role.\n2. Set the format.\n</changes>";

test("rewrite-prompt prints the meta-prompt from any prompt source, with optional context and use case", async () => {
  const plain = await run(["rewrite-prompt", "--prompt", PROMPT, "--json"]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.deepEqual(JSON.parse(plain.stdout), { prompt: buildRewritePrompt(PROMPT) });
  const viaStdin = await run(["rewrite-prompt"], { stdin: PROMPT });
  assert.equal(viaStdin.code, 0, viaStdin.stderr);
  assert.equal(viaStdin.stdout, `${buildRewritePrompt(PROMPT)}\n`);

  await withTempDir(async (dir) => {
    const useCasePath = join(dir, "use-case.txt");
    await writeFile(useCasePath, "Changelog entry read by developers.\n", "utf8");
    const detailed = await run(["rewrite-prompt", "--prompt", PROMPT, "--context", "Notes come from git log.", "--use-case-file", useCasePath, "--json"]);
    assert.equal(detailed.code, 0, detailed.stderr);
    assert.deepEqual(JSON.parse(detailed.stdout), {
      prompt: buildRewritePrompt(PROMPT, { context: "Notes come from git log.", useCase: "Changelog entry read by developers." }),
    });
  });

  const both = await run(["rewrite-prompt", "--prompt", PROMPT, "--context", "a", "--context-file", "b.txt"]);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /^AMBIGUOUS_INPUT: Provide --context or --context-file, not both/u);
  const oversized = await run(["rewrite-prompt", "--prompt", PROMPT, "--use-case", "x".repeat(MAX_REWRITE_INPUT_CHARACTERS + 1)]);
  assert.equal(oversized.code, 2);
  assert.match(oversized.stderr, /^INPUT_TOO_LARGE: Rewrite use case/u);
  const unsupported = await run(["rewrite-prompt", "--prompt", PROMPT, "--reply", "r.txt"]);
  assert.equal(unsupported.code, 2);
  assert.match(unsupported.stderr, /not supported by 'rewrite-prompt'/u);
});

test("rewrite-candidate parses a reply from a file or stdin into a candidate that score accepts", async () => {
  const expected = rewriteCandidate(PROMPT, "You are a release manager.\n\n<notes>\n[paste the release notes]\n</notes>\n\nSummarize them in 3 bullets.");
  const viaStdin = await run(["rewrite-candidate", "--prompt", PROMPT, "--json"], { stdin: REPLY });
  assert.equal(viaStdin.code, 0, viaStdin.stderr);
  const payload = JSON.parse(viaStdin.stdout);
  assert.deepEqual(Object.keys(payload), ["analysis", "candidate", "changes"]);
  assert.deepEqual(payload.candidate, { id: expected.id, pattern: "rewrite", prompt: expected.prompt.text });
  assert.deepEqual(payload.analysis, ["No audience."]);
  assert.deepEqual(payload.changes, ["Added a role.", "Set the format."]);

  await withTempDir(async (dir) => {
    const replyPath = join(dir, "reply.md");
    await writeFile(replyPath, `Sure, here you go:\n${REPLY}`, "utf8");
    const viaFile = await run(["rewrite-candidate", "--prompt", PROMPT, "--reply", replyPath]);
    assert.equal(viaFile.code, 0, viaFile.stderr);
    assert.ok(viaFile.stdout.startsWith(`== ${expected.id} (rewrite, pattern: rewrite)\n${expected.prompt.text}\n\nAnalysis\n- No audience.\n\nChanges\n1. Added a role.\n2. Set the format.\n`));

    const outputs = {
      candidates: [
        ...buildPreviewCandidates(PROMPT).map((candidate) => ({ id: candidate.id, outputs: { preview: "" } })),
        { id: payload.candidate.id, prompt: payload.candidate.prompt, outputs: { preview: "- one\n- two\n- three" } },
      ],
    };
    const outputsPath = join(dir, "outputs.json");
    await writeFile(outputsPath, JSON.stringify(outputs), "utf8");
    const scored = await run(["score", "--outputs", outputsPath, "--json"]);
    assert.equal(scored.code, 0, scored.stderr);
    assert.equal(JSON.parse(scored.stdout).ranking[0].candidateId, payload.candidate.id);
  });
});

test("rewrite-candidate rejects an unparseable reply, a missing draft, and ambiguous sources", async () => {
  const invalid = await run(["rewrite-candidate", "--prompt", PROMPT], { stdin: "Here is a better prompt: be specific." });
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /^INVALID_REWRITE_REPLY: rewrite reply has no complete <rewritten_prompt> section/u);
  const noDraft = await run(["rewrite-candidate"], { stdin: REPLY });
  assert.equal(noDraft.code, 2);
  assert.match(noDraft.stderr, /^MISSING_INPUT: Provide the draft prompt from --prompt or --prompt-file\./u);
  const noReply = await run(["rewrite-candidate", "--prompt", PROMPT]);
  assert.equal(noReply.code, 2);
  assert.match(noReply.stderr, /^MISSING_INPUT: Provide the rewrite reply/u);
  await withTempDir(async (dir) => {
    const replyPath = join(dir, "reply.md");
    await writeFile(replyPath, REPLY, "utf8");
    const ambiguous = await run(["rewrite-candidate", "--prompt", PROMPT, "--reply", replyPath], { stdin: REPLY });
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /^AMBIGUOUS_INPUT:/u);
  });
});
