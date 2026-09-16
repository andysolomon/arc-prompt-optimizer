import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CoreValidationError,
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_COMPLETION_PROMPT_CHARACTERS,
  MAX_CRITERION_TERM_CHARACTERS,
  MAX_CRITERION_TERM_COUNT,
  MAX_CRITERION_TOTAL_TERM_CHARACTERS,
  FixtureCompletionAdapter,
  checkFixtureOutput,
} from "../dist/core/index.js";

const fixtureUrl = new URL("../fixtures/completions.json", import.meta.url);
const suiteUrl = new URL("../fixtures/evaluation-suites.json", import.meta.url);
const definitions = JSON.parse(await readFile(fixtureUrl, "utf8"));
const suites = JSON.parse(await readFile(suiteUrl, "utf8"));

test("fixture completions and metadata are repeatable and isolated", async () => {
  const mutableDefinitions = JSON.parse(JSON.stringify(definitions));
  const adapter = new FixtureCompletionAdapter(mutableDefinitions);
  const request = { fixtureId: "profile-json", prompt: "Return the profile fixture." };
  const first = await adapter.complete(request);
  const second = await adapter.complete(request);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.metadata.source = "changed locally";
  mutableDefinitions[0].metadata.source = "changed at source";
  const third = await adapter.complete(request);
  assert.equal(third.metadata.source, "offline");
  assert.equal(third.model, "fixture-model-v1");
});

test("fixture completion snapshots ignore inherited optional result fields", async () => {
  const names = ["model", "finishReason", "latencyMs", "usage", "metadata", "costUsd"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]));
  try {
    for (const name of names) {
      Object.defineProperty(Object.prototype, name, {
        configurable: true,
        value: name === "model" ? "polluted-model" : name === "usage" ? { inputTokens: 99 } : 1,
      });
    }
    const adapter = new FixtureCompletionAdapter([{ id: "minimal", text: "ok" }]);
    const result = await adapter.complete({ fixtureId: "minimal", prompt: "short" });

    assert.deepEqual(result, { text: "ok" });
    assert.equal(result.model, undefined);
    assert.equal(result.finishReason, undefined);
    assert.equal(result.latencyMs, undefined);
    assert.equal(result.usage, undefined);
    assert.equal(result.metadata, undefined);
    assert.equal(result.costUsd, undefined);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
      else delete Object.prototype[name];
    }
  }
});

test("representative suites deterministically check formats and content constraints", async () => {
  const adapter = new FixtureCompletionAdapter(definitions);
  const observed = [];
  for (const suite of suites) {
    for (const fixtureCase of suite.cases) {
      const completion = await adapter.complete({
        fixtureId: fixtureCase.completionFixtureId,
        prompt: `Fixture case: ${fixtureCase.id}`,
      });
      const result = checkFixtureOutput(completion.text, fixtureCase.criteria);
      observed.push([suite.id, fixtureCase.id, result]);
      assert.equal(result.passed, true, fixtureCase.id);
    }
  }

  assert.deepEqual(observed, JSON.parse(JSON.stringify(observed)));
  assert.equal(observed.length, 4);
});

test("invalid JSON, lists, limits, keywords, and forbidden phrases fail structurally", () => {
  assert.equal(checkFixtureOutput("not json", { expectedFormat: "json" }).passed, false);
  assert.equal(checkFixtureOutput("- one\nplain two", { expectedFormat: "bullet_list" }).passed, false);
  assert.equal(checkFixtureOutput("1. one\n3. three", { expectedFormat: "numbered_list" }).passed, false);
  assert.equal(checkFixtureOutput("1. one", { expectedFormat: "numbered_list" }).passed, true);
  assert.equal(checkFixtureOutput("one two three", { maxWords: 2 }).passed, false);
  assert.equal(checkFixtureOutput("alpha", { requiredKeywords: ["beta"] }).passed, false);
  assert.equal(checkFixtureOutput("avoid secret text", { forbiddenPhrases: ["secret"] }).passed, false);
  assert.throws(
    () => checkFixtureOutput("value", { expectedFormat: "xml" }),
    (error) => error.code === "INVALID_FIXTURE" && error.message.includes("Unsupported"),
  );
});

test("fixture criteria normalize hostile array prototypes before iteration", () => {
  const invoked = [];
  const hostilePrototype = Object.create(Array.prototype, {
    entries: {
      configurable: true,
      get() {
        invoked.push("entries");
        throw new Error("hostile entries getter was invoked");
      },
    },
    map: {
      configurable: true,
      get() {
        invoked.push("map");
        throw new Error("hostile map getter was invoked");
      },
    },
    [Symbol.iterator]: {
      configurable: true,
      get() {
        invoked.push("iterator");
        throw new Error("hostile iterator getter was invoked");
      },
    },
  });
  const requiredKeywords = ["ok"];
  Object.setPrototypeOf(requiredKeywords, hostilePrototype);

  const result = checkFixtureOutput("ok", { requiredKeywords });

  assert.equal(result.passed, true);
  assert.deepEqual(invoked, []);
});

test("invalid expected formats never invoke conversion hooks", () => {
  const conversions = [];
  const hostileFormat = Object.create(null);
  for (const key of ["toString", "valueOf"]) {
    Object.defineProperty(hostileFormat, key, {
      configurable: true,
      get() {
        conversions.push(key);
        throw new Error(`${key} getter was invoked`);
      },
    });
  }
  Object.defineProperty(hostileFormat, Symbol.toPrimitive, {
    configurable: true,
    get() {
      conversions.push("Symbol.toPrimitive");
      throw new Error("Symbol.toPrimitive getter was invoked");
    },
  });

  assert.throws(
    () => checkFixtureOutput("value", { expectedFormat: hostileFormat }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INVALID_FIXTURE" &&
      error.message === "Unsupported expected format; expected one of json, bullet_list, or numbered_list.",
  );
  assert.deepEqual(conversions, []);
});

test("fixture checks reject malformed runtime criteria containers and schemas", () => {
  for (const [text, criteria] of [
    [null, {}],
    ["value", null],
    ["value", { requiredKeywords: "value" }],
    ["value", { forbiddenPhrases: ["ok", 2] }],
    ["value", { maxWords: "2" }],
  ]) {
    assert.throws(
      () => checkFixtureOutput(text, criteria),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_FIXTURE",
    );
  }
});

test("fixture criteria inspect hidden fields and preserve allowed data fields", () => {
  const allowedHiddenField = {};
  Object.defineProperty(allowedHiddenField, "requiredKeywords", {
    value: ["ok"],
    enumerable: false,
  });
  assert.equal(checkFixtureOutput("ok", allowedHiddenField).passed, true);

  const unknownHiddenField = { expectedFormat: "json" };
  Object.defineProperty(unknownHiddenField, "zHidden", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => checkFixtureOutput("{}", unknownHiddenField),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INVALID_FIXTURE" &&
      error.message.includes("zHidden"),
  );

  const accessorField = {};
  Object.defineProperty(accessorField, "requiredKeywords", {
    get() {
      throw new Error("accessor was invoked");
    },
    enumerable: false,
  });
  assert.throws(
    () => checkFixtureOutput("ok", accessorField),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INVALID_FIXTURE" &&
      error.message.includes("requiredKeywords") &&
      error.message.includes("data property"),
  );
});

test("fixture limits preserve hidden fields and schema reads stay own-only", async () => {
  const limits = {};
  Object.defineProperty(limits, "maxPromptCharacters", { enumerable: false, value: 4 });
  Object.defineProperty(limits, "maxOutputCharacters", { enumerable: false, value: 1_000 });
  const adapter = new FixtureCompletionAdapter(definitions, limits);
  await assert.rejects(
    adapter.complete({ fixtureId: "profile-json", prompt: "12345" }),
    (error) => error.code === "INPUT_TOO_LARGE" && error.message.includes("limit is 4"),
  );

  const names = ["fixtureId", "prompt", "maxOutputCharacters", "requiredKeywords", "maxWords"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]));
  try {
    Object.defineProperty(Object.prototype, "fixtureId", { configurable: true, value: "profile-json" });
    Object.defineProperty(Object.prototype, "prompt", { configurable: true, value: "polluted" });
    Object.defineProperty(Object.prototype, "maxOutputCharacters", { configurable: true, value: 1 });
    Object.defineProperty(Object.prototype, "requiredKeywords", { configurable: true, value: ["polluted"] });
    Object.defineProperty(Object.prototype, "maxWords", { configurable: true, value: 0 });

    await assert.rejects(
      adapter.complete({}),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_FIXTURE",
    );
    await assert.doesNotReject(adapter.complete({ fixtureId: "profile-json", prompt: "ok" }));
    const result = checkFixtureOutput("polluted", {});
    assert.deepEqual(result.checks, []);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
      else delete Object.prototype[name];
    }
  }
});

test("fixture adapter rejects limits above provider-neutral completion maxima", () => {
  assert.throws(
    () => new FixtureCompletionAdapter(definitions, {
      maxPromptCharacters: MAX_COMPLETION_PROMPT_CHARACTERS + 1,
      maxOutputCharacters: MAX_COMPLETION_OUTPUT_CHARACTERS,
    }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INPUT_TOO_LARGE" &&
      error.message.includes(`limit is ${MAX_COMPLETION_PROMPT_CHARACTERS}`),
  );

  assert.throws(
    () => new FixtureCompletionAdapter(definitions, {
      maxPromptCharacters: MAX_COMPLETION_PROMPT_CHARACTERS,
      maxOutputCharacters: MAX_COMPLETION_OUTPUT_CHARACTERS + 1,
    }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "OUTPUT_TOO_LARGE" &&
      error.message.includes(`limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}`),
  );
});

test("fixture validation bounds oversized own key containers", () => {
  const criteria = { expectedFormat: "json" };
  for (let index = 0; index < 1_100; index += 1) {
    Object.defineProperty(criteria, `unknown${index}`, { enumerable: false, value: true });
  }
  assert.throws(
    () => checkFixtureOutput("{}", criteria),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INVALID_FIXTURE" &&
      error.message.includes("own properties") &&
      error.message.includes("limit"),
  );
});

test("fixture criteria bound term count, term length, and aggregate input", () => {
  const tooManyTerms = Array.from({ length: MAX_CRITERION_TERM_COUNT + 1 }, () => "term");
  assert.throws(
    () => checkFixtureOutput("term", { requiredKeywords: tooManyTerms }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INPUT_TOO_LARGE" &&
      error.message.includes("term count") &&
      error.message.includes(`limit is ${MAX_CRITERION_TERM_COUNT}`),
  );

  assert.throws(
    () =>
      checkFixtureOutput("term", {
        requiredKeywords: ["x".repeat(MAX_CRITERION_TERM_CHARACTERS + 1)],
      }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INPUT_TOO_LARGE" &&
      error.message.includes("entry at index 0") &&
      error.message.includes(`limit is ${MAX_CRITERION_TERM_CHARACTERS}`),
  );

  const aggregateTerms = [];
  let remaining = MAX_CRITERION_TOTAL_TERM_CHARACTERS + 1;
  while (remaining > 0) {
    const length = Math.min(MAX_CRITERION_TERM_CHARACTERS, remaining);
    aggregateTerms.push("x".repeat(length));
    remaining -= length;
  }
  assert.throws(
    () => checkFixtureOutput("x", { requiredKeywords: aggregateTerms }),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "INPUT_TOO_LARGE" &&
      error.message.includes("terms total") &&
      error.message.includes(`limit is ${MAX_CRITERION_TOTAL_TERM_CHARACTERS}`),
  );
});

test("fixture adapter validates every completion result field and request container", async () => {
  const malformedDefinitions = [
    null,
    { ...definitions[0], text: 4 },
    { ...definitions[0], model: null },
    { ...definitions[0], finishReason: null },
    { ...definitions[0], latencyMs: -1 },
    { ...definitions[0], usage: null },
    { ...definitions[0], usage: { inputTokens: 1, outputTokens: "2" } },
    { ...definitions[0], usage: { inputTokens: -1 } },
    { ...definitions[0], metadata: null },
    { ...definitions[0], metadata: { source: {} } },
    { ...definitions[0], costUsd: "0.1" },
  ];
  for (const definition of malformedDefinitions) {
    assert.throws(
      () => new FixtureCompletionAdapter([definition]),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_FIXTURE",
    );
  }

  const adapter = new FixtureCompletionAdapter(definitions);
  for (const request of [null, {}, { fixtureId: "profile-json", prompt: 3 }]) {
    await assert.rejects(
      adapter.complete(request),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_FIXTURE",
    );
  }
});

test("fixture adapter accepts missing metrics and partial usage", async () => {
  const adapter = new FixtureCompletionAdapter([
    { id: "minimal", text: "ok" },
    { id: "partial", text: "ok", usage: { inputTokens: 2 } },
  ]);
  assert.deepEqual(
    await adapter.complete({ fixtureId: "minimal", prompt: "short" }),
    { text: "ok" },
  );
  assert.deepEqual(
    await adapter.complete({ fixtureId: "partial", prompt: "short" }),
    { text: "ok", usage: { inputTokens: 2 } },
  );
});

test("fixture adapter rejects unknown ids and bounded request violations", async () => {
  const adapter = new FixtureCompletionAdapter(definitions, {
    maxPromptCharacters: 10,
    maxOutputCharacters: 1_000,
  });
  await assert.rejects(
    adapter.complete({ fixtureId: "unknown", prompt: "short" }),
    (error) => error.code === "UNKNOWN_FIXTURE" && error.message.includes("Available fixtures:"),
  );
  await assert.rejects(
    adapter.complete({ fixtureId: "profile-json", prompt: "this prompt is too long" }),
    (error) => error.code === "INPUT_TOO_LARGE" && error.message.includes("limit is 10"),
  );
  await assert.rejects(
    adapter.complete({
      fixtureId: "profile-json",
      prompt: "short",
      maxOutputCharacters: 5,
    }),
    (error) => error.code === "OUTPUT_TOO_LARGE" && error.message.includes("request limit is 5"),
  );
});
