import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETION_CANCELLED_CODE,
  COMPLETION_TIMEOUT_CODE,
  CompletionCancelledError,
  CompletionTimeoutError,
  CoreValidationError,
  FixtureCompletionAdapter,
  MAX_COMPLETION_MODEL_CHARACTERS,
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_COMPLETION_PROMPT_CHARACTERS,
  aggregateCases,
  completeWithTimeout,
  evaluateCase,
  measureCompletion,
  meanMeasurement,
  normalizeCompletionRequest,
  validateCompletionResult,
} from "../dist/core/index.js";
import { normalizeCompletionRequest as normalizeCompletionRequestFromAdapterBarrel } from "../dist/adapters/index.js";

const fixture = {
  id: "offline",
  text: "okay",
  model: "fixture-model",
  finishReason: "stop",
  latencyMs: 1,
  usage: { inputTokens: 2, outputTokens: 1 },
  metadata: { source: "test" },
};

const resultWithoutOptionalMeasurements = {
  text: "ok",
};

test("completion request normalization is exported from the package root and adapter barrel", () => {
  const request = { prompt: "hello", maxOutputCharacters: 20 };
  assert.deepEqual(normalizeCompletionRequest(request), request);
  assert.equal(normalizeCompletionRequestFromAdapterBarrel, normalizeCompletionRequest);
});

test("provider-neutral adapters accept requests without fixtureId and receive a cooperative signal", async () => {
  let receivedRequest;
  let receivedSignal;
  const adapter = {
    async complete(request, signal) {
      receivedRequest = request;
      receivedSignal = signal;
      return resultWithoutOptionalMeasurements;
    },
  };

  const result = await completeWithTimeout(adapter, { prompt: "hello", maxOutputCharacters: 20 }, { timeoutMs: 100 });
  assert.deepEqual(receivedRequest, { prompt: "hello", maxOutputCharacters: 20 });
  assert.equal(receivedSignal.aborted, false);
  assert.equal("usage" in result, false);
  assert.equal("costUsd" in result, false);
});

test("completion requests are normalized to own data before adapter calls", async () => {
  const names = ["model", "maxOutputCharacters"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]));
  let receivedRequest;
  try {
    for (const name of names) {
      Object.defineProperty(Object.prototype, name, {
        configurable: true,
        value: name === "model" ? "polluted-model" : 1,
      });
    }
    const result = await completeWithTimeout(
      {
        async complete(request) {
          receivedRequest = request;
          return { text: "ok" };
        },
      },
      { prompt: "hello" },
    );

    assert.deepEqual(result, { text: "ok" });
    assert.equal(receivedRequest.prompt, "hello");
    assert.equal(receivedRequest.model, undefined);
    assert.equal(receivedRequest.maxOutputCharacters, undefined);
    assert.deepEqual(Object.keys(receivedRequest), ["prompt"]);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
      else delete Object.prototype[name];
    }
  }
});

test("completion request and result accessors are rejected without invocation", async () => {
  let requestGetterCalls = 0;
  const request = {};
  Object.defineProperty(request, "prompt", {
    configurable: true,
    enumerable: true,
    get() {
      requestGetterCalls += 1;
      throw new Error("request prompt getter was invoked");
    },
  });
  await assert.rejects(
    completeWithTimeout({ async complete() { return { text: "ok" }; } }, request),
    (error) => error instanceof CoreValidationError && error.code === "INVALID_EVALUATION",
  );
  assert.equal(requestGetterCalls, 0);

  let resultGetterCalls = 0;
  const result = {};
  Object.defineProperty(result, "text", {
    configurable: true,
    enumerable: true,
    get() {
      resultGetterCalls += 1;
      throw new Error("result text getter was invoked");
    },
  });
  await assert.rejects(
    completeWithTimeout({ async complete() { return result; } }, { prompt: "hello" }),
    (error) => error instanceof CoreValidationError && error.code === "INVALID_EVALUATION",
  );
  assert.equal(resultGetterCalls, 0);
});

test("inherited completion result fields stay unknown during evaluation", async () => {
  const names = ["model", "finishReason", "latencyMs", "usage", "costUsd"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)]));
  try {
    for (const name of names) {
      Object.defineProperty(Object.prototype, name, {
        configurable: true,
        get() {
          throw new Error(`${name} getter was invoked`);
        },
      });
    }
    const adapter = { async complete() { return { text: "ok" }; } };
    const result = await completeWithTimeout(adapter, { prompt: "hello" });
    assert.equal(result.model, undefined);
    assert.equal(result.finishReason, undefined);
    assert.equal(result.latencyMs, undefined);
    assert.equal(result.usage, undefined);
    assert.equal(result.costUsd, undefined);
    assert.equal(measureCompletion(result).latencyMs.status, "unknown");

    const evaluation = await evaluateCase(
      adapter,
      { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" },
      { id: "case", name: "case", completionFixtureId: "ignored", criteria: {} },
    );
    assert.equal(evaluation.model, null);
    assert.equal(evaluation.finishReason, null);
    assert.equal(evaluation.measurements.latencyMs.status, "unknown");
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
      else delete Object.prototype[name];
    }
  }
});

test("completion result validation accepts partial usage and rejects malformed present fields", async () => {
  const partial = {
    text: "ok",
    usage: { inputTokens: 2 },
  };
  assert.deepEqual(
    await completeWithTimeout({ async complete() { return partial; } }, { prompt: "hello" }, { timeoutMs: 100 }),
    partial,
  );

  const malformed = [
    { text: "ok", model: 1 },
    { text: "ok", model: "" },
    { text: "ok", model: "m".repeat(MAX_COMPLETION_MODEL_CHARACTERS + 1) },
    { text: "ok", finishReason: 1 },
    { text: "ok", latencyMs: -1 },
    { text: "ok", latencyMs: 1.5 },
    { text: "ok", metadata: null },
    { text: "ok", metadata: { source: {} } },
    { text: "ok", usage: null },
    { text: "ok", usage: { outputTokens: "1" } },
    { text: "ok", usage: { extra: 1 } },
    { text: "ok", costUsd: -1 },
    { text: "ok", extra: true },
  ];
  for (const result of malformed) {
    await assert.rejects(
      completeWithTimeout({ async complete() { return result; } }, { prompt: "hello" }, { timeoutMs: 100 }),
      (error) => error instanceof CoreValidationError &&
        (error.code === "INVALID_EVALUATION" || error.code === "INPUT_TOO_LARGE"),
    );
  }
});

test("model selection is bounded, forwarded, and available to direct evaluation", async () => {
  let receivedRequest;
  const adapter = {
    async complete(request) {
      receivedRequest = request;
      return { text: "ok" };
    },
  };
  await completeWithTimeout(adapter, { model: "scoped-model", prompt: "hello" }, { timeoutMs: 100 });
  assert.deepEqual(receivedRequest, { model: "scoped-model", prompt: "hello" });

  for (const model of [null, "", "m".repeat(MAX_COMPLETION_MODEL_CHARACTERS + 1), 3]) {
    await assert.rejects(
      completeWithTimeout(adapter, { model, prompt: "hello" }, { timeoutMs: 100 }),
      (error) => error instanceof CoreValidationError &&
        (error.code === "INVALID_EVALUATION" || error.code === "INPUT_TOO_LARGE"),
    );
  }

  await evaluateCase(
    adapter,
    { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" },
    { id: "case", name: "case", completionFixtureId: "ignored", criteria: { requiredKeywords: ["ok"] } },
    { model: "evaluation-model" },
  );
  assert.equal(receivedRequest.model, "evaluation-model");
});

test("direct evaluation uses the same completion result validation as timeout evaluation", async () => {
  const candidate = { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" };
  const evaluationCase = { id: "case", name: "case", completionFixtureId: "ignored", criteria: {} };
  for (const options of [{}, { timeoutMs: 100 }]) {
    await assert.rejects(
      evaluateCase(
        { async complete() { return { text: "ok", latencyMs: "1" }; } },
        candidate,
        evaluationCase,
        options,
      ),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_EVALUATION",
    );
  }
});

test("timeout options reject hostile containers without invoking accessors", async () => {
  let calls = 0;
  const adapter = { async complete() { calls += 1; return resultWithoutOptionalMeasurements; } };
  const accessor = {};
  Object.defineProperty(accessor, "timeoutMs", {
    configurable: true,
    enumerable: true,
    get() { throw new Error("timeout getter invoked"); },
  });
  const symbol = Symbol("timeout");
  const symbolOptions = { timeoutMs: 10 };
  Object.defineProperty(symbolOptions, symbol, { value: true, enumerable: true });

  for (const options of [
    [],
    Object.assign(Object.create({ timeoutMs: 10 }), {}),
    { unknown: true },
    accessor,
    symbolOptions,
  ]) {
    await assert.rejects(
      completeWithTimeout(adapter, { prompt: "hello" }, options),
      (error) => error instanceof TypeError,
    );
  }
  assert.equal(calls, 0);
});

test("provider-neutral completion requests and returned text stay within explicit bounds", async () => {
  const adapter = { async complete() { return resultWithoutOptionalMeasurements; } };
  await assert.rejects(
    completeWithTimeout(adapter, { prompt: "p".repeat(MAX_COMPLETION_PROMPT_CHARACTERS + 1) }),
    (error) => error instanceof CoreValidationError && error.code === "INPUT_TOO_LARGE",
  );
  await assert.rejects(
    completeWithTimeout(adapter, { prompt: "p", maxOutputCharacters: MAX_COMPLETION_OUTPUT_CHARACTERS + 1 }),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );
  await assert.rejects(
    completeWithTimeout(
      { async complete() { return { ...resultWithoutOptionalMeasurements, text: "x".repeat(MAX_COMPLETION_OUTPUT_CHARACTERS + 1) }; } },
      { prompt: "p" },
    ),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );
});

test("completion result validation checks outputLimit before reading the result", () => {
  const invalidLimits = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10"];
  for (const outputLimit of invalidLimits) {
    assert.throws(
      () => validateCompletionResult({ text: "ok" }, outputLimit),
      (error) => error instanceof CoreValidationError && error.code === "INVALID_EVALUATION",
    );
  }
  assert.throws(
    () => validateCompletionResult({ text: "ok" }, MAX_COMPLETION_OUTPUT_CHARACTERS + 1),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );

  let textGetterCalls = 0;
  const result = {};
  Object.defineProperty(result, "text", {
    configurable: true,
    enumerable: true,
    get() {
      textGetterCalls += 1;
      throw new Error("result text getter was invoked");
    },
  });
  assert.throws(
    () => validateCompletionResult(result, 0),
    (error) => error instanceof CoreValidationError && error.code === "INVALID_EVALUATION",
  );
  assert.equal(textGetterCalls, 0);
});

test("evaluation forwards its optional AbortSignal to the completion adapter", async () => {
  const controller = new AbortController();
  let receivedSignal;
  await evaluateCase(
    {
      async complete(_request, signal) {
        receivedSignal = signal;
        return resultWithoutOptionalMeasurements;
      },
    },
    { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" },
    { id: "case", name: "case", completionFixtureId: "ignored", criteria: { requiredKeywords: ["ok"] } },
    { signal: controller.signal },
  );
  assert.equal(receivedSignal, controller.signal);
});

test("pre-abort rejects with the stable cancellation error without calling the adapter", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    completeWithTimeout(
      { async complete() { calls += 1; return resultWithoutOptionalMeasurements; } },
      { prompt: "ignored" },
      { signal: controller.signal, timeoutMs: 100 },
    ),
    (error) => error instanceof CompletionCancelledError && error.code === COMPLETION_CANCELLED_CODE,
  );
  assert.equal(calls, 0);
});

test("direct evaluation pre-abort rejects without calling the adapter", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    evaluateCase(
      { async complete() { calls += 1; return resultWithoutOptionalMeasurements; } },
      { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" },
      { id: "case", name: "case", completionFixtureId: "ignored", criteria: {} },
      { signal: controller.signal },
    ),
    (error) => error instanceof CompletionCancelledError && error.code === COMPLETION_CANCELLED_CODE,
  );
  assert.equal(calls, 0);
});

test("in-flight cancellation aborts the adapter signal and returns a stable error", async () => {
  const controller = new AbortController();
  let receivedSignal;
  const adapter = {
    complete(_request, signal) {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("provider abort")), { once: true });
      });
    },
  };

  const completion = completeWithTimeout(adapter, { prompt: "wait" }, { signal: controller.signal, timeoutMs: 1_000 });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(completion, (error) => error instanceof CompletionCancelledError && error.code === "CANCELLED");
  assert.equal(receivedSignal.aborted, true);
});

test("timeout aborts the adapter signal and returns a stable timeout error", async () => {
  let receivedSignal;
  const adapter = {
    complete(_request, signal) {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("provider abort")), { once: true });
      });
    },
  };

  await assert.rejects(
    completeWithTimeout(adapter, { prompt: "wait" }, { timeoutMs: 5 }),
    (error) => error instanceof CompletionTimeoutError && error.code === COMPLETION_TIMEOUT_CODE && error.timeoutMs === 5,
  );
  assert.equal(receivedSignal.aborted, true);
});

test("cancellation wins when requested before a zero-delay timeout", async () => {
  const controller = new AbortController();
  const completion = completeWithTimeout(
    { complete() { return new Promise(() => {}); } },
    { prompt: "wait" },
    { signal: controller.signal, timeoutMs: 0 },
  );
  controller.abort();
  await assert.rejects(completion, (error) => error instanceof CompletionCancelledError);
});

test("evaluation propagates timeoutMs through the completion lifecycle helper", async () => {
  let receivedSignal;
  await assert.rejects(
    evaluateCase(
      {
        complete(_request, signal) {
          receivedSignal = signal;
          return new Promise(() => {});
        },
      },
      { id: "candidate", prompt: { pattern: "test", text: "Reply.", variablesUsed: [] }, origin: "rendered" },
      { id: "case", name: "case", completionFixtureId: "ignored", criteria: {} },
      { timeoutMs: 5 },
    ),
    (error) => error instanceof CompletionTimeoutError && error.timeoutMs === 5,
  );
  assert.equal(receivedSignal.aborted, true);
});

test("settlement clears the timeout timer", async () => {
  const originalClearTimeout = globalThis.clearTimeout;
  let clearCount = 0;
  globalThis.clearTimeout = (handle) => {
    clearCount += 1;
    return originalClearTimeout(handle);
  };
  try {
    await completeWithTimeout({ async complete() { return resultWithoutOptionalMeasurements; } }, { prompt: "done" }, { timeoutMs: 100 });
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(clearCount, 1);
});

test("fixture adapter retains offline request and output bounds", async () => {
  const adapter = new FixtureCompletionAdapter([fixture], { maxPromptCharacters: 5, maxOutputCharacters: 10 });
  await assert.rejects(
    adapter.complete({ fixtureId: "offline", prompt: "too long" }),
    (error) => error instanceof CoreValidationError && error.code === "INPUT_TOO_LARGE",
  );
  await assert.rejects(
    adapter.complete({ fixtureId: "offline", prompt: "short", maxOutputCharacters: 3 }),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );
});

test("provider-specific finish reasons remain compatible and unsafe token sums stay unknown", async () => {
  const result = await completeWithTimeout(
    {
      async complete() {
        return { ...resultWithoutOptionalMeasurements, finishReason: "tool_call" };
      },
    },
    { prompt: "hello" },
  );
  assert.equal(result.finishReason, "tool_call");

  const measurements = measureCompletion({
    latencyMs: 1,
    usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
  });
  assert.equal(measurements.inputTokens.status, "measured");
  assert.equal(measurements.outputTokens.status, "measured");
  assert.equal(measurements.totalTokens.status, "unknown");
  assert.equal(meanMeasurement([
    { status: "measured", value: Number.MAX_SAFE_INTEGER },
    { status: "measured", value: 1 },
  ], "totalTokens").status, "unknown");
  assert.equal(aggregateCases([]).totalTokens.status, "unknown");
});
