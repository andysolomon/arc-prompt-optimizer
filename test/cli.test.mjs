import assert from "node:assert/strict";
import { access, constants, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateCandidatesBounded } from "../dist/cli/evaluate.js";
import { MAX_CLI_PROMPT_CHARACTERS, MAX_CLI_SUITE_JSON_BYTES, writeJsonOutput } from "../dist/cli/io.js";
import { MAX_CLI_JSON_CHARACTERS, stringifyCliJson } from "../dist/cli/json.js";
import { runCli } from "../dist/cli/main.js";
import { formatJson } from "../dist/cli/output.js";

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
  const code = await runCli({
    argv: args,
    io: {
      stdin,
      stdout,
      stderr,
      cwd: options.cwd ?? rootPath,
    },
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "arc-prompt-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSuite(dir, suite) {
  const path = join(dir, "suite.json");
  await writeFile(path, JSON.stringify(suite), "utf8");
  return path;
}

function suiteWithLargeRedactedChecks() {
  return {
    id: "large-redacted",
    cases: Array.from({ length: 64 }, (_, index) => ({
      id: `case-${index}`,
      name: `Case ${index}`,
      completionFixtureId: "exact-ok",
      criteria: { exactMatch: `${String(index).padStart(2, "0")}-${"x".repeat(1_000)}` },
    })),
  };
}

const exactSuite = {
  id: "cli",
  cases: [{ id: "case", name: "Case", completionFixtureId: "exact-ok", criteria: { exactMatch: "ok" } }],
};

test("help paths write documented help to stdout without credentials", async () => {
  const helpCases = [
    { args: ["--help"], includes: ["optimize", "evaluate", "patterns", "models", "candidates", "score", "--timeout <ms>", "--timeout-ms <ms>"] },
    { args: ["-h"], includes: ["optimize", "evaluate", "patterns", "models", "candidates", "score", "--timeout <ms>", "--timeout-ms <ms>"] },
    { args: ["optimize", "--help"], includes: ["arc-prompt optimize", "--suite", "--prompt", "--timeout <ms>", "--timeout-ms <ms>"] },
    { args: ["evaluate", "--help"], includes: ["arc-prompt evaluate", "--suite", "--prompt", "--timeout <ms>", "--timeout-ms <ms>"] },
    { args: ["patterns", "--help"], includes: ["arc-prompt patterns", "--json"] },
    { args: ["models", "--help"], includes: ["arc-prompt models", "--json", "--simulate"], excludes: ["--default-model"] },
    { args: ["candidates", "--help"], includes: ["arc-prompt candidates", "--prompt", "--json"], excludes: ["--model", "--simulate"] },
    { args: ["score", "--help"], includes: ["arc-prompt score", "--suite", "--outputs", "--json"], excludes: ["--model", "--simulate"] },
  ];

  for (const { args, includes, excludes = [] } of helpCases) {
    const result = await run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^Usage: arc-prompt/u);
    for (const text of includes) assert.ok(result.stdout.includes(text), `${args.join(" ")} missing ${text}`);
    for (const text of excludes) assert.equal(result.stdout.includes(text), false, `${args.join(" ")} included ${text}`);
  }
});

test("patterns lists the offline catalog without live Pi imports", async () => {
  const result = await run(["patterns", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.patterns.some((pattern) => pattern.name === "critique"));
  assert.equal(result.stderr, "");

  const cliFiles = await readdir(new URL("../dist/cli", import.meta.url));
  for (const file of cliFiles.filter((entry) => entry.endsWith(".js"))) {
    const source = await readFile(new URL(`../dist/cli/${file}`, import.meta.url), "utf8");
    assert.equal(/from ["']@earendil-works\/pi-coding-agent/u.test(source), false, file);
  }
});

test("package bin points at the CLI wrapper", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.bin["arc-prompt"], "./bin/arc-prompt");
  assert.equal(packageJson.scripts.prepack, "npm run build");
  assert.deepEqual(packageJson.files, ["bin/arc-prompt", "dist/**"]);
  await access(new URL("../bin/arc-prompt", import.meta.url), constants.X_OK);
});

test("CLI JSON serializer recursively sorts keys above the core canonical limit", () => {
  const value = {
    z: 1,
    a: { z: 2, a: [{ b: "x", a: "y" }] },
    large: "q".repeat(49_000),
  };
  const json = stringifyCliJson(value);
  assert.match(json, /^\{"a":\{"a":\[\{"a":"y","b":"x"\}\],"z":2\},"large":"q+/u);
  assert.equal(JSON.parse(json).large.length, 49_000);
});

test("models lists simulated models without credentials", async () => {
  const result = await run(["models", "--simulate", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).models.map((model) => model.canonical), ["simulate/balanced", "simulate/fast"]);
});

test("patterns and models reject unsupported command-specific flags before live adapter setup", async () => {
  const cases = [
    ["patterns", "--timeout", "nope"],
    ["patterns", "--timeout"],
    ["patterns", "--simulate"],
    ["patterns", "--model="],
    ["patterns", "--default-model", "simulate/balanced"],
    ["models", "--model="],
    ["models", "--timeout", "nope"],
    ["models", "--default-model", "simulate/balanced"],
    ["models", "--prompt", "x"],
  ];

  for (const args of cases) {
    const result = await run(args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, /INVALID_ARGUMENT/u, args.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("@earendil-works/pi-coding-agent"), false);
  }
});

test("evaluate supports --prompt, --prompt-file, and stdin sources", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);
    const promptPath = join(dir, "prompt.txt");
    await writeFile(promptPath, "Say ok from a file", "utf8");

    for (const [args, options] of [
      [["evaluate", "--simulate", "--suite", suitePath, "--prompt", "Say ok", "--json"], {}],
      [["evaluate", "--simulate", "--suite", suitePath, "--prompt-file", promptPath, "--json"], {}],
      [["evaluate", "--simulate", "--suite", suitePath, "--json"], { stdin: "Say ok on stdin" }],
    ]) {
      const result = await run(args, options);
      assert.equal(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.suiteId, "cli");
      assert.equal(payload.completionsUsed, 1);
      assert.equal(JSON.stringify(payload).includes("Say ok"), false);
      assert.equal(JSON.stringify(payload).includes('"text"'), false);
    }
  });
});

test("evaluate rejects ambiguous, empty, and oversized prompt input", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);
    const ambiguous = await run(
      ["evaluate", "--simulate", "--suite", suitePath, "--prompt", "argument"],
      { stdin: "stdin" },
    );
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /AMBIGUOUS_INPUT/u);

    const empty = await run(["evaluate", "--simulate", "--suite", suitePath, "--prompt", "   "]);
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /MISSING_INPUT/u);

    const oversized = await run(["evaluate", "--simulate", "--suite", suitePath], {
      stdin: "x".repeat(MAX_CLI_PROMPT_CHARACTERS + 1),
    });
    assert.equal(oversized.code, 2);
    assert.match(oversized.stderr, /INPUT_TOO_LARGE/u);
  });
});

test("evaluate and optimize enforce the CLI prompt boundary", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);
    const boundaryPrompt = "x".repeat(MAX_CLI_PROMPT_CHARACTERS);
    for (const command of ["evaluate", "optimize"]) {
      const accepted = await run([command, "--simulate", "--suite", suitePath, "--prompt", boundaryPrompt, "--json"]);
      assert.equal(accepted.code, 0, accepted.stderr);

      const rejected = await run([
        command,
        "--suite",
        join(dir, "missing-suite.json"),
        "--prompt",
        `${boundaryPrompt}x`,
      ]);
      assert.equal(rejected.code, 2);
      assert.match(rejected.stderr, /INPUT_TOO_LARGE/u);
    }
  });
});

test("evaluate rejects formerly core-sized prompt inputs at the CLI boundary", async () => {
  for (const length of [47_999, 48_000]) {
    const result = await run([
      "evaluate",
      "--suite",
      "missing-suite.json",
      "--prompt",
      "x".repeat(length),
    ]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /INPUT_TOO_LARGE/u);
  }
});

test("oversized prompt-file and stdin inputs fail before adapter setup", async () => {
  await withTempDir(async (dir) => {
    const promptPath = join(dir, "oversized-prompt.txt");
    await writeFile(promptPath, "x".repeat(MAX_CLI_PROMPT_CHARACTERS + 1), "utf8");

    for (const [args, options] of [
      [["evaluate", "--suite", "missing-suite.json", "--prompt-file", promptPath], {}],
      [["evaluate", "--suite", "missing-suite.json"], { stdin: "x".repeat(MAX_CLI_PROMPT_CHARACTERS + 1) }],
    ]) {
      const result = await run(args, options);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /INPUT_TOO_LARGE/u);
      assert.equal(result.stderr.includes("@earendil-works/pi-coding-agent"), false);
    }
  });
});

test("duplicate output and suite validation failures are user-input errors before adapter setup", async () => {
  await withTempDir(async (dir) => {
    const emptySuite = join(dir, "empty.json");
    const invalidSuite = join(dir, "invalid.json");
    const oversizedSuite = join(dir, "oversized.json");
    await writeFile(emptySuite, JSON.stringify({ id: "empty", cases: [] }), "utf8");
    await writeFile(invalidSuite, JSON.stringify({ id: "bad", cases: [{}] }), "utf8");
    await writeFile(oversizedSuite, `${" ".repeat(MAX_CLI_SUITE_JSON_BYTES + 1)}[]`, "utf8");

    const cases = [
      [["evaluate", "--suite", "missing.json", "--prompt", "x", "--output", "a.json", "--output", "b.json"], /--output/u],
      [["evaluate", "--suite", emptySuite, "--prompt", "x"], /must include at least one case/u],
      [["evaluate", "--suite", invalidSuite, "--prompt", "x"], /INVALID_EVALUATION/u],
      [["evaluate", "--suite", oversizedSuite, "--prompt", "x"], /INPUT_TOO_LARGE/u],
    ];

    for (const [args, pattern] of cases) {
      const result = await run(args);
      assert.equal(result.code, 2, args.join(" "));
      assert.match(result.stderr, pattern, args.join(" "));
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.includes("@earendil-works/pi-coding-agent"), false);
      assert.equal(/\n\s+at /u.test(result.stderr), false);
    }
  });
});

test("evaluate forwards the selected model", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);
    const result = await run([
      "evaluate",
      "--simulate",
      "--suite",
      suitePath,
      "--prompt",
      "Say ok",
      "--model",
      "simulate/fast",
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.candidates[0].cases[0].model, "simulate/fast");
  });
});

test("timeouts are enforced through the completion timeout path", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, {
      id: "slow-suite",
      cases: [{ id: "slow", name: "Slow", completionFixtureId: "slow", criteria: { requiredKeywords: ["ok"] } }],
    });
    const result = await run([
      "evaluate",
      "--simulate",
      "--suite",
      suitePath,
      "--prompt",
      "Slow check",
      "--timeout-ms",
      "1",
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /CompletionTimeoutError/u);
  });
});

test("evaluate accepts both timeout flag spellings in simulated mode", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);

    for (const timeoutFlag of ["--timeout", "--timeout-ms"]) {
      const result = await run([
        "evaluate",
        "--simulate",
        "--suite",
        suitePath,
        "--prompt",
        "Say ok",
        timeoutFlag,
        "1000",
        "--json",
      ]);
      assert.equal(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.suiteId, "cli");
      assert.equal(payload.completionsUsed, 1);
    }
  });
});

test("optimize emits redacted stable JSON and no default output file", async () => {
  await withTempDir(async (dir) => {
    const before = await readdir(dir);
    const suitePath = await writeSuite(dir, exactSuite);
    const result = await run([
      "optimize",
      "--simulate",
      "--suite",
      suitePath,
      "--prompt",
      "Draft a concise answer",
      "--concurrency",
      "2",
      "--json",
    ], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.completionsUsed, 3);
    assert.equal(payload.ranking.length, 3);
    assert.equal("candidates" in payload, false);
    assert.equal(JSON.stringify(payload).includes("Draft a concise answer"), false);
    assert.deepEqual((await readdir(dir)).sort(), [...before, "suite.json"].sort());
  });
});

test("optimize accepts both timeout flag spellings in simulated mode", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);

    for (const timeoutFlag of ["--timeout", "--timeout-ms"]) {
      const result = await run([
        "optimize",
        "--simulate",
        "--suite",
        suitePath,
        "--prompt",
        "Draft a concise answer",
        timeoutFlag,
        "1000",
        "--json",
      ]);
      assert.equal(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.completionsUsed, 3);
      assert.equal(payload.ranking.length, 3);
    }
  });
});

test("explicit --output writes the full result while stdout remains redacted", async () => {
  await withTempDir(async (dir) => {
    const suitePath = await writeSuite(dir, exactSuite);
    const outputPath = join(dir, "result.json");
    const result = await run([
      "optimize",
      "--simulate",
      "--suite",
      suitePath,
      "--prompt",
      "Keep this prompt private on stdout",
      "--output",
      outputPath,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const stdoutPayload = JSON.parse(result.stdout);
    assert.equal(stdoutPayload.output, outputPath);
    assert.equal(JSON.stringify(stdoutPayload).includes("Keep this prompt private"), false);
    const filePayload = JSON.parse(await readFile(outputPath, "utf8"));
    assert.ok(JSON.stringify(filePayload).includes("Keep this prompt private"));
  });
});

test("large redacted stdout and explicit full-output files are bounded above core canonical size", async () => {
  await withTempDir(async (dir) => {
    const largeSuitePath = await writeSuite(dir, suiteWithLargeRedactedChecks());
    const evaluateResult = await run([
      "evaluate",
      "--simulate",
      "--suite",
      largeSuitePath,
      "--prompt",
      "Say ok",
      "--json",
    ]);
    assert.equal(evaluateResult.code, 0, evaluateResult.stderr);
    assert.ok(evaluateResult.stdout.length > 48_000);
    assert.equal(JSON.parse(evaluateResult.stdout).candidates[0].cases.length, 64);
    assert.equal(evaluateResult.stdout.includes("Say ok"), false);

    const outputPath = join(dir, "full-output.json");
    const optimizeResult = await run([
      "optimize",
      "--simulate",
      "--suite",
      largeSuitePath,
      "--prompt",
      "p".repeat(MAX_CLI_PROMPT_CHARACTERS),
      "--output",
      outputPath,
      "--json",
    ]);
    assert.equal(optimizeResult.code, 0, optimizeResult.stderr);
    assert.ok(optimizeResult.stdout.length > 48_000);
    assert.equal(JSON.parse(optimizeResult.stdout).output, outputPath);
    const fullOutput = await readFile(outputPath, "utf8");
    assert.ok(fullOutput.length > 48_000);
    assert.ok(fullOutput.includes("p".repeat(1_024)));
  });
});

test("CLI JSON newline is included in stdout and explicit file size limits", async () => {
  await withTempDir(async (dir) => {
    const accepted = { a: "x".repeat(MAX_CLI_JSON_CHARACTERS - 1 - '{"a":""}'.length) };
    const rejected = { a: "x".repeat(MAX_CLI_JSON_CHARACTERS - '{"a":""}'.length) };
    const outputPath = join(dir, "bounded.json");

    const stdoutText = formatJson(accepted);
    assert.equal(stdoutText.length, MAX_CLI_JSON_CHARACTERS);
    assert.equal(JSON.parse(stdoutText).a.length, accepted.a.length);

    await assert.rejects(
      async () => formatJson(rejected),
      (error) => error.code === "OUTPUT_TOO_LARGE",
    );

    await writeJsonOutput(
      { command: "evaluate", flags: new Map([["output", [outputPath]]]) },
      { stdin: new FakeStdin(), stdout: new FakeWritable(), stderr: new FakeWritable(), cwd: dir },
      accepted,
    );
    assert.equal((await readFile(outputPath, "utf8")).length, MAX_CLI_JSON_CHARACTERS);

    await assert.rejects(
      async () =>
        await writeJsonOutput(
          { command: "evaluate", flags: new Map([["output", [join(dir, "too-large.json")]]]) },
          { stdin: new FakeStdin(), stdout: new FakeWritable(), stderr: new FakeWritable(), cwd: dir },
          rejected,
        ),
      (error) => error.code === "OUTPUT_TOO_LARGE",
    );
  });
});

test("evaluation stops scheduling after first failure and aborts in-flight completions", async () => {
  const calls = [];
  const aborted = [];
  const adapter = {
    async complete(request, signal) {
      calls.push(request.fixtureId);
      if (request.fixtureId === "fail") {
        await Promise.resolve();
        throw new Error("first evaluation failed");
      }
      if (request.fixtureId === "hold") {
        return await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.push(request.fixtureId);
            reject(new Error("hold aborted"));
          }, { once: true });
        });
      }
      throw new Error(`unexpected scheduled fixture ${request.fixtureId}`);
    },
  };
  const candidate = {
    id: "candidate",
    prompt: { pattern: "cli_input", text: "prompt", variablesUsed: [] },
    origin: "fixture",
  };
  const suite = {
    id: "abort-suite",
    cases: [
      { id: "fail", name: "Fail", completionFixtureId: "fail", criteria: { exactMatch: "ok" } },
      { id: "hold", name: "Hold", completionFixtureId: "hold", criteria: { exactMatch: "ok" } },
      { id: "queued", name: "Queued", completionFixtureId: "queued", criteria: { exactMatch: "ok" } },
    ],
  };

  await assert.rejects(
    evaluateCandidatesBounded(adapter, [candidate], suite, { timeoutMs: 1_000 }, 2),
    /first evaluation failed/u,
  );
  assert.deepEqual(calls, ["fail", "hold"]);
  assert.deepEqual(aborted, ["hold"]);
});

test("evaluation propagates an undefined rejection and aborts in-flight completions", async () => {
  const calls = [];
  const aborted = [];
  const adapter = {
    async complete(request, signal) {
      calls.push(request.fixtureId);
      if (request.fixtureId === "fail-undefined") {
        await Promise.resolve();
        throw undefined;
      }
      if (request.fixtureId === "hold") {
        return await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted.push(request.fixtureId);
            reject(new Error("hold aborted"));
          }, { once: true });
        });
      }
      throw new Error(`unexpected scheduled fixture ${request.fixtureId}`);
    },
  };
  const candidate = {
    id: "candidate",
    prompt: { pattern: "cli_input", text: "prompt", variablesUsed: [] },
    origin: "fixture",
  };
  const suite = {
    id: "undefined-rejection-suite",
    cases: [
      { id: "fail", name: "Fail", completionFixtureId: "fail-undefined", criteria: { exactMatch: "ok" } },
      { id: "hold", name: "Hold", completionFixtureId: "hold", criteria: { exactMatch: "ok" } },
      { id: "queued", name: "Queued", completionFixtureId: "queued", criteria: { exactMatch: "ok" } },
    ],
  };

  let rejected = false;
  try {
    await evaluateCandidatesBounded(adapter, [candidate], suite, { timeoutMs: 1_000 }, 2);
  } catch (error) {
    rejected = true;
    assert.equal(error, undefined);
  }
  assert.equal(rejected, true);
  assert.deepEqual(calls, ["fail-undefined", "hold"]);
  assert.deepEqual(aborted, ["hold"]);
});

test("argument and suite errors are surfaced without stack traces", async () => {
  await withTempDir(async (dir) => {
    const invalidSuite = join(dir, "bad.json");
    await writeFile(invalidSuite, "{", "utf8");
    const suitePath = await writeSuite(dir, exactSuite);
    const badConcurrency = await run(["evaluate", "--simulate", "--suite", suitePath, "--prompt", "x", "--concurrency", "17"]);
    assert.equal(badConcurrency.code, 2);
    assert.match(badConcurrency.stderr, /between 1 and 16/u);

    const badSuite = await run(["evaluate", "--simulate", "--suite", invalidSuite, "--prompt", "x"]);
    assert.equal(badSuite.code, 2);
    assert.match(badSuite.stderr, /INVALID_JSON/u);
    assert.equal(badSuite.stderr.includes(" at "), false);
  });
});

test("invalid concurrency, timeout, and model selection are validated before live adapter setup", async () => {
  const cases = [
    ["evaluate", "--suite", "missing-suite.json", "--prompt", "x", "--concurrency", "17"],
    ["evaluate", "--suite", "missing-suite.json", "--prompt", "x", "--timeout", `${Number.MAX_SAFE_INTEGER}`],
    ["evaluate", "--suite", "missing-suite.json", "--prompt", "x", "--model="],
    ["evaluate", "--suite", "missing-suite.json", "--prompt", "x", "--model", "m".repeat(257)],
    ["evaluate", "--suite", "missing-suite.json", "--prompt", "x", "--default-model="],
  ];

  for (const args of cases) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /INVALID_ARGUMENT|INPUT_TOO_LARGE/u);
    assert.equal(result.stderr.includes("@earendil-works/pi-coding-agent"), false);
  }

  const source = await readFile(new URL("../dist/cli/main.js", import.meta.url), "utf8");
  assert.ok(source.indexOf("const options = cliOptions(args);") < source.indexOf("await selectAdapter(args, io.cwd, options.defaultModel);"));
});
