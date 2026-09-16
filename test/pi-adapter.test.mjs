import assert from "node:assert/strict";
import test from "node:test";

import {
  CompletionCancelledError,
  CompletionTimeoutError,
  CoreValidationError,
} from "../dist/core/index.js";
import {
  PiCompletionAdapter,
  PiCompletionAdapterError,
  buildPiCompletionContext,
  completeWithTimeout,
  createPiCompletionAdapter,
  createPiCompletionClientFromRegistry,
  mapPiAssistantMessage,
  outputCharacterLimitToMaxTokens,
} from "../dist/adapters/index.js";

const testModel = Object.freeze({
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
});

function assistantMessage(overrides = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hello world" }],
    api: "openai-completions",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 12,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 16,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createFakeClient({ models = [testModel], complete } = {}) {
  const calls = [];
  const client = {
    getModels: () => models,
    async complete(model, context, options) {
      calls.push({ model, context, options });
      if (options?.signal?.aborted) {
        return assistantMessage({ stopReason: "aborted", content: [{ type: "text", text: "" }] });
      }
      if (complete) return complete(model, context, options, calls);
      return assistantMessage();
    },
  };
  return { client, calls };
}

test("pi completion adapter exports are available from the adapter barrel", () => {
  assert.equal(typeof PiCompletionAdapter, "function");
  assert.equal(typeof createPiCompletionAdapter, "function");
  assert.equal(typeof buildPiCompletionContext, "function");
  assert.equal(typeof mapPiAssistantMessage, "function");
  assert.equal(typeof createPiCompletionClientFromRegistry, "function");
});

test("buildPiCompletionContext wraps the prompt as a single user message", () => {
  const context = buildPiCompletionContext("optimize this");
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].role, "user");
  assert.equal(context.messages[0].content, "optimize this");
  assert.equal(typeof context.messages[0].timestamp, "number");
});

test("createPiCompletionClientFromRegistry honors modelScope all and available", () => {
  const availableModel = { ...testModel, id: "available-only" };
  const catalogModel = { ...testModel, id: "catalog-only" };
  const registry = {
    getAvailable: () => [availableModel],
    getAll: () => [availableModel, catalogModel],
    complete: async () => assistantMessage(),
  };

  const availableClient = createPiCompletionClientFromRegistry(registry, { modelScope: "available" });
  assert.deepEqual(availableClient.getModels().map((model) => model.id), ["available-only"]);

  const allClient = createPiCompletionClientFromRegistry(registry, { modelScope: "all" });
  assert.deepEqual(allClient.getModels().map((model) => model.id), ["available-only", "catalog-only"]);
});

test("pi adapter resolves explicit and default model references without provider payloads", async () => {
  const altModel = { ...testModel, id: "alt-model" };
  const { client, calls } = createFakeClient({ models: [testModel, altModel] });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });

  await adapter.complete({ prompt: "hi", model: "test-provider/alt-model" });
  assert.equal(calls.at(-1).model.id, "alt-model");
  assert.deepEqual(Object.keys(calls.at(-1).options ?? {}), ["maxTokens", "cacheRetention"]);
  assert.equal(calls.at(-1).options.cacheRetention, "none");
  assert.equal(calls.at(-1).context.messages[0].content, "hi");

  await adapter.complete({ prompt: "hi" });
  assert.equal(calls.at(-1).model.id, "test-model");

  const controller = new AbortController();
  await adapter.complete({ prompt: "hi" }, controller.signal);
  assert.equal(calls.at(-1).options.signal, controller.signal);
});

test("pi adapter validates defaultModel type, emptiness, and length at construction", () => {
  const { client } = createFakeClient();
  assert.throws(
    () => createPiCompletionAdapter({ client, defaultModel: "   " }),
    (error) => error instanceof CoreValidationError && error.message.includes("defaultModel"),
  );
  assert.throws(
    () => createPiCompletionAdapter({ client, defaultModel: "x".repeat(257) }),
    (error) => error instanceof CoreValidationError && error.code === "INPUT_TOO_LARGE",
  );
});

test("pi adapter distinguishes ambiguous and unknown model references", async () => {
  const duplicateA = { ...testModel, id: "shared-id", provider: "provider-a" };
  const duplicateB = { ...testModel, id: "shared-id", provider: "provider-b" };
  const { client } = createFakeClient({ models: [duplicateA, duplicateB] });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "provider-a/shared-id" });

  await assert.rejects(
    adapter.complete({ prompt: "hi", model: "shared-id" }),
    (error) => error instanceof CoreValidationError && error.message.includes("Ambiguous Pi model"),
  );
  await assert.rejects(
    adapter.complete({ prompt: "hi", model: "missing/model" }),
    (error) => error instanceof CoreValidationError && error.message.includes("Unknown Pi model"),
  );
});

test("pi adapter maps text, usage, cost, finish reason, latency, and response model identity", async () => {
  const runtimeModel = { ...testModel, id: "runtime-model", provider: "runtime-provider" };
  const { client } = createFakeClient({
    models: [testModel, runtimeModel],
    complete: () =>
      assistantMessage({
        provider: "runtime-provider",
        model: "runtime-model",
        responseModel: "runtime-provider/runtime-model",
        content: [{ type: "text", text: "hello world" }],
      }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "runtime-provider/runtime-model" });
  const result = await adapter.complete({ prompt: "hi" });

  assert.equal(result.text, "hello world");
  assert.equal(result.model, "runtime-provider/runtime-model");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.usage.inputTokens, 12);
  assert.equal(result.usage.outputTokens, 4);
  assert.equal(result.costUsd, 0.003);
  assert.equal(typeof result.latencyMs, "number");
});

test("pi adapter preserves provider prefix when responseModel already names the provider", async () => {
  const { client } = createFakeClient({
    complete: () =>
      assistantMessage({
        provider: "test-provider",
        model: "test-model",
        responseModel: "test-provider/test-model",
      }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const result = await adapter.complete({ prompt: "hi" });
  assert.equal(result.model, "test-provider/test-model");
});

test("pi adapter preserves provider prefix when raw model ids contain slashes (openrouter/fireworks)", async () => {
  const openrouterRaw = { ...testModel, id: "meta-llama/llama-4-scout:free", provider: "openrouter" };
  const { client: openrouterClient } = createFakeClient({
    models: [openrouterRaw],
    complete: () =>
      assistantMessage({
        provider: "openrouter",
        model: "meta-llama/llama-4-scout:free",
        responseModel: "meta-llama/llama-4-scout:free",
      }),
  });
  const openrouterAdapter = createPiCompletionAdapter({
    client: openrouterClient,
    defaultModel: "openrouter/meta-llama/llama-4-scout:free",
  });
  const openrouterResult = await openrouterAdapter.complete({ prompt: "hi" });
  assert.equal(openrouterResult.model, "openrouter/meta-llama/llama-4-scout:free");

  const fireworksRaw = { ...testModel, id: "accounts/fireworks/models/kimi-k2p6", provider: "fireworks" };
  const { client: fireworksClient } = createFakeClient({
    models: [fireworksRaw],
    complete: () =>
      assistantMessage({
        provider: "fireworks",
        model: "accounts/fireworks/models/kimi-k2p6",
        responseModel: "accounts/fireworks/models/kimi-k2p6",
      }),
  });
  const fireworksAdapter = createPiCompletionAdapter({
    client: fireworksClient,
    defaultModel: "fireworks/accounts/fireworks/models/kimi-k2p6",
  });
  const fireworksResult = await fireworksAdapter.complete({ prompt: "hi" });
  assert.equal(fireworksResult.model, "fireworks/accounts/fireworks/models/kimi-k2p6");
});

test("mapPiAssistantMessage omits unknown usage and cost measurements", () => {
  const mapped = mapPiAssistantMessage(
    assistantMessage({
      usage: {
        input: Number.NaN,
        output: -1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: Number.NaN },
      },
    }),
    3,
    100,
  );
  assert.equal("usage" in mapped, false);
  assert.equal("costUsd" in mapped, false);
});

test("pi adapter rejects oversized output with OUTPUT_TOO_LARGE instead of truncating", async () => {
  const { client } = createFakeClient({
    complete: () => assistantMessage({ content: [{ type: "text", text: "abcdefghij" }] }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  await assert.rejects(
    adapter.complete({ prompt: "hi", maxOutputCharacters: 5 }),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );
});

test("pi adapter preserves Unicode output without surrogate splitting", async () => {
  const emojiText = "abc😀def";
  const { client } = createFakeClient({
    complete: () => assistantMessage({ content: [{ type: "text", text: emojiText }] }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const withinLimit = await adapter.complete({ prompt: "hi", maxOutputCharacters: emojiText.length });
  assert.equal(withinLimit.text, emojiText);

  await assert.rejects(
    adapter.complete({ prompt: "hi", maxOutputCharacters: emojiText.length - 1 }),
    (error) => error instanceof CoreValidationError && error.code === "OUTPUT_TOO_LARGE",
  );
});

test("pi adapter accepts valid empty text output", async () => {
  const { client } = createFakeClient({
    complete: () => assistantMessage({ content: [{ type: "text", text: "" }] }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const result = await adapter.complete({ prompt: "hi" });
  assert.equal(result.text, "");
});

test("pi adapter uses conservative maxTokens for non-Latin output budgets", async () => {
  const captured = [];
  const { client } = createFakeClient({
    complete: (_model, _context, options) => {
      captured.push(options?.maxTokens);
      return assistantMessage({ content: [{ type: "text", text: "漢字" }] });
    },
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  await adapter.complete({ prompt: "hi", maxOutputCharacters: 9 });
  assert.equal(captured.at(-1), 9);
  assert.equal(outputCharacterLimitToMaxTokens(9, testModel), 9);
});

test("pi adapter forwards cancellation through complete options and aborted responses", async () => {
  const controller = new AbortController();
  const { client } = createFakeClient({
    complete: async (_model, _context, options) => {
      controller.abort();
      return assistantMessage({ stopReason: "aborted", content: [{ type: "text", text: "nope" }] });
    },
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });

  await assert.rejects(
    adapter.complete({ prompt: "hi" }, controller.signal),
    (error) => error instanceof CompletionCancelledError,
  );
});

test("pi adapter treats caller abort as cancellation when the client rejects", async () => {
  const controller = new AbortController();
  const { client } = createFakeClient({
    complete: (_model, _context, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("provider transport failed")),
          { once: true },
        );
      }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const completion = adapter.complete({ prompt: "hi" }, controller.signal);
  controller.abort();
  await assert.rejects(completion, (error) => error instanceof CompletionCancelledError);
});

test("pi adapter cancels never-settling direct calls when the caller aborts", async () => {
  const controller = new AbortController();
  const { client } = createFakeClient({
    complete: () => new Promise(() => {}),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const completion = adapter.complete({ prompt: "wait" }, controller.signal);
  controller.abort();
  await assert.rejects(completion, (error) => error instanceof CompletionCancelledError);
});

test("pi adapter surfaces provider errors and unknown models", async () => {
  const { client } = createFakeClient({
    complete: () => assistantMessage({ stopReason: "error", errorMessage: "quota exceeded", content: [] }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  await assert.rejects(
    adapter.complete({ prompt: "hi" }),
    (error) => error instanceof PiCompletionAdapterError && error.message.includes("quota exceeded"),
  );

  const empty = createPiCompletionAdapter({ client: createFakeClient({ models: [] }).client });
  await assert.rejects(
    empty.complete({ prompt: "hi", model: "missing/model" }),
    (error) => error instanceof CoreValidationError && error.message.includes("Unknown Pi model"),
  );
});

test("pi adapter rejects fixtureId and interoperates with completeWithTimeout", async () => {
  const { client } = createFakeClient();
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  await assert.rejects(
    adapter.complete({ fixtureId: "offline", prompt: "hi" }),
    (error) => error instanceof CoreValidationError,
  );

  const result = await completeWithTimeout(adapter, { prompt: "hi" }, { timeoutMs: 1_000 });
  assert.equal(result.text, "hello world");
});

test("completeWithTimeout cancels in-flight pi completions", async () => {
  const controller = new AbortController();
  const { client } = createFakeClient({
    complete: (_model, _context, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => {
          resolve(assistantMessage({ stopReason: "aborted", content: [{ type: "text", text: "" }] }));
        }, { once: true });
      }),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  const completion = completeWithTimeout(adapter, { prompt: "wait" }, { signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();
  await assert.rejects(completion, (error) => error instanceof CompletionCancelledError);
});

test("completeWithTimeout times out slow pi completions", async () => {
  const { client } = createFakeClient({
    complete: () => new Promise(() => {}),
  });
  const adapter = createPiCompletionAdapter({ client, defaultModel: "test-provider/test-model" });
  await assert.rejects(
    completeWithTimeout(adapter, { prompt: "wait" }, { timeoutMs: 5 }),
    (error) => error instanceof CompletionTimeoutError,
  );
});
