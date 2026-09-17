import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream, registerApiProvider, unregisterApiProviders } from "@earendil-works/pi-ai/compat";

import {
  PiCompletionAdapterError,
  createPiCompletionAdapter,
  createPiCompletionClientFromRegistry,
} from "../dist/adapters/index.js";

// Pi hosts before ModelRegistry.complete() (e.g. ARC Pi on Pi 0.80.x) expose only
// getApiKeyAndHeaders(); the client must fall back to the pi-ai compat dispatcher.

const LEGACY_API = "arc-prompt-legacy-test-api";
const SOURCE_ID = "arc-prompt-legacy-test";

const legacyModel = Object.freeze({
  id: "legacy-model",
  name: "Legacy Model",
  api: LEGACY_API,
  provider: "legacy-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
});

function withLegacyApi(fn) {
  const streams = [];
  const stream = (model, context, options) => {
    streams.push({ model, context, options });
    const events = createAssistantMessageEventStream();
    queueMicrotask(() =>
      events.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "legacy reply" }],
          api: LEGACY_API,
          provider: model.provider,
          model: model.id,
          usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      }),
    );
    return events;
  };
  registerApiProvider({ api: LEGACY_API, stream, streamSimple: stream }, SOURCE_ID);
  return Promise.resolve(fn(streams)).finally(() => unregisterApiProviders(SOURCE_ID));
}

function legacyRegistry(auth) {
  const authCalls = [];
  return {
    authCalls,
    getAll: () => [legacyModel],
    getAvailable: () => [legacyModel],
    getApiKeyAndHeaders: async (model) => {
      authCalls.push(`${model.provider}/${model.id}`);
      return auth;
    },
  };
}

test("registries without complete() resolve request auth and dispatch through pi-ai compat", async () => {
  await withLegacyApi(async (streams) => {
    const registry = legacyRegistry({ ok: true, apiKey: "fake-legacy-key", headers: { "x-test": "1" } });
    const adapter = createPiCompletionAdapter({
      client: createPiCompletionClientFromRegistry(registry),
      defaultModel: "legacy-provider/legacy-model",
    });
    const result = await adapter.complete({ prompt: "hello legacy host" });
    assert.equal(result.text, "legacy reply");
    assert.deepEqual(registry.authCalls, ["legacy-provider/legacy-model"]);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].options.apiKey, "fake-legacy-key");
    assert.deepEqual(streams[0].options.headers, { "x-test": "1" });
    assert.ok(streams[0].options.maxTokens <= legacyModel.maxTokens);
    assert.equal(streams[0].context.messages[0].content, "hello legacy host");
  });
});

test("a failed legacy auth lookup is reported without dispatching a request", async () => {
  await withLegacyApi(async (streams) => {
    const registry = legacyRegistry({ ok: false, error: "No API key found for legacy-provider" });
    const adapter = createPiCompletionAdapter({
      client: createPiCompletionClientFromRegistry(registry),
      defaultModel: "legacy-provider/legacy-model",
    });
    await assert.rejects(
      adapter.complete({ prompt: "hello" }),
      (error) => error instanceof PiCompletionAdapterError && /No API key found/u.test(error.message),
    );
    assert.equal(streams.length, 0);
  });
});

test("registries with complete() keep using it and never take the legacy auth path", async () => {
  await withLegacyApi(async (streams) => {
    const registry = legacyRegistry({ ok: true, apiKey: "unused" });
    const completeCalls = [];
    registry.complete = async (model, context, options) => {
      completeCalls.push(options);
      return {
        role: "assistant",
        content: [{ type: "text", text: "modern reply" }],
        api: LEGACY_API,
        provider: model.provider,
        model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
    };
    const adapter = createPiCompletionAdapter({
      client: createPiCompletionClientFromRegistry(registry),
      defaultModel: "legacy-provider/legacy-model",
    });
    assert.equal((await adapter.complete({ prompt: "hello" })).text, "modern reply");
    assert.equal(completeCalls.length, 1);
    assert.deepEqual(registry.authCalls, []);
    assert.equal(streams.length, 0);
  });
});
