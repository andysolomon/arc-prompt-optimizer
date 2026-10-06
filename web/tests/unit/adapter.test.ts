import { describe, expect, it } from "vitest";
import {
  AiSdkCompletionAdapter,
  REASONING_MAX_OUTPUT_TOKENS,
  languageModelFor,
  outputCharacterLimitToMaxTokens,
  toCompletionResult,
} from "@/lib/adapter";
import type { ServerEnv } from "@/lib/env";
import { MODELS, OPENAI_COMPATIBLE_BASE_URLS, availableModels, getModel } from "@/lib/models";
import { MODEL_IDS } from "@/lib/types";

const fullEnv: ServerEnv = {
  ANTHROPIC_API_KEY: "a",
  OPENAI_API_KEY: "o",
  GOOGLE_GENERATIVE_AI_API_KEY: "g",
  MINIMAX_API_KEY: "m",
  OPENCODE_API_KEY: "z",
};

describe("model mapping", () => {
  it("maps every canonical id to a provider, provider model id, and env var", () => {
    expect(MODELS.map((m) => m.id)).toEqual([...MODEL_IDS]);
    expect(getModel("anthropic/claude-sonnet-4-5")).toMatchObject({ provider: "anthropic", providerModelId: "claude-sonnet-4-5", envVar: "ANTHROPIC_API_KEY" });
    expect(getModel("anthropic/claude-haiku-4-5")).toMatchObject({ provider: "anthropic", providerModelId: "claude-haiku-4-5" });
    expect(getModel("openai/gpt-5-mini")).toMatchObject({ provider: "openai", providerModelId: "gpt-5-mini", envVar: "OPENAI_API_KEY" });
    expect(getModel("google/gemini-2.5-flash")).toMatchObject({ provider: "google", providerModelId: "gemini-2.5-flash", envVar: "GOOGLE_GENERATIVE_AI_API_KEY" });
    expect(getModel("minimax/MiniMax-M3")).toMatchObject({ provider: "minimax", providerModelId: "MiniMax-M3", envVar: "MINIMAX_API_KEY" });
    expect(getModel("opencode-go/kimi-k2.6")).toMatchObject({ provider: "opencode-go", providerModelId: "kimi-k2.6", envVar: "OPENCODE_API_KEY" });
  });

  it("routes MiniMax and OpenCode Go through their OpenAI-compatible endpoints", () => {
    expect(OPENAI_COMPATIBLE_BASE_URLS.minimax).toBe("https://api.minimax.io/v1");
    expect(OPENAI_COMPATIBLE_BASE_URLS["opencode-go"]).toBe("https://opencode.ai/zen/go/v1");
  });

  it("builds an AI SDK model for each id and reports the provider in the model id", () => {
    for (const id of MODEL_IDS) {
      const model = languageModelFor(id, fullEnv);
      expect(typeof model === "string" ? model : model.modelId).toBe(getModel(id).providerModelId);
      if (typeof model !== "string") expect(model.provider).toContain(getModel(id).provider);
    }
  });

  it("refuses to build a model whose provider key is missing", () => {
    expect(() => languageModelFor("openai/gpt-5-mini", { ANTHROPIC_API_KEY: "a" })).toThrow(/OPENAI_API_KEY/u);
  });

  it("filters the model list to providers with a key", () => {
    expect(availableModels({}).map((m) => m.id)).toEqual([]);
    expect(availableModels({ OPENAI_API_KEY: "x", GOOGLE_GENERATIVE_AI_API_KEY: " " }).map((m) => m.id)).toEqual(["openai/gpt-5-mini"]);
    expect(availableModels({ ANTHROPIC_API_KEY: "x" }).map((m) => m.id)).toEqual(["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5"]);
    expect(availableModels({ MINIMAX_API_KEY: "x" }).map((m) => m.id)).toEqual(["minimax/MiniMax-M3", "minimax/MiniMax-M2.7"]);
    expect(availableModels({ OPENCODE_API_KEY: "x" }).map((m) => m.provider)).toEqual(["opencode-go", "opencode-go", "opencode-go", "opencode-go"]);
  });

  it("leaves OpenCode Go cost unknown because the plan is a flat subscription", () => {
    const result = toCompletionResult({ modelId: "opencode-go/glm-5.3", text: "x", finishReason: "stop", latencyMs: 1, inputTokens: 10, outputTokens: 10, outputLimit: 100 });
    expect(result.costUsd).toBeUndefined();
    expect(toCompletionResult({ modelId: "minimax/MiniMax-M3", text: "x", finishReason: "stop", latencyMs: 1, inputTokens: 1_000_000, outputTokens: 1_000_000, outputLimit: 100 }).costUsd).toBeCloseTo(1.5);
  });
});

describe("completion result mapping", () => {
  it("records latency, usage, and a cost from the pricing table", () => {
    const result = toCompletionResult({
      modelId: "anthropic/claude-haiku-4-5",
      text: "hello",
      finishReason: "stop",
      latencyMs: 1234.6,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      outputLimit: 16_384,
    });
    expect(result).toEqual({
      text: "hello",
      model: "anthropic/claude-haiku-4-5",
      finishReason: "stop",
      latencyMs: 1235,
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      costUsd: 6,
    });
  });

  it("leaves usage and cost absent instead of zero when the provider reports nothing", () => {
    const result = toCompletionResult({
      modelId: "openai/gpt-5-mini",
      text: "x",
      finishReason: "stop",
      latencyMs: 10,
      inputTokens: undefined,
      outputTokens: undefined,
      outputLimit: 16_384,
    });
    expect("usage" in result).toBe(false);
    expect("costUsd" in result).toBe(false);
  });

  it("omits cost when only one token count is known", () => {
    const result = toCompletionResult({
      modelId: "google/gemini-2.5-flash",
      text: "x",
      finishReason: "stop",
      latencyMs: 10,
      inputTokens: 12,
      outputTokens: undefined,
      outputLimit: 16_384,
    });
    expect(result.usage).toEqual({ inputTokens: 12 });
    expect(result.costUsd).toBeUndefined();
  });

  it("truncates oversized output to the core limit and marks the finish reason", () => {
    const result = toCompletionResult({
      modelId: "openai/gpt-5-mini",
      text: "a".repeat(20),
      finishReason: "stop",
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      outputLimit: 10,
    });
    expect(result.text).toHaveLength(10);
    expect(result.finishReason).toBe("length");
  });

  it("derives a max token budget from the character limit", () => {
    expect(outputCharacterLimitToMaxTokens(16_384)).toBe(4096);
    expect(outputCharacterLimitToMaxTokens(1)).toBe(1);
  });

  it("leaves thinking models room to reason before they answer", () => {
    expect(outputCharacterLimitToMaxTokens(16_384, true)).toBe(REASONING_MAX_OUTPUT_TOKENS);
    expect(outputCharacterLimitToMaxTokens(1, true)).toBe(REASONING_MAX_OUTPUT_TOKENS);
  });
});

describe("AiSdkCompletionAdapter", () => {
  it("uses the reasoning token cap for MiniMax and OpenCode Go models", async () => {
    for (const id of ["minimax/MiniMax-M3", "opencode-go/glm-5.3"] as const) {
      let cap: number | undefined;
      const adapter = new AiSdkCompletionAdapter(id, fullEnv, async (args) => {
        cap = args.maxOutputTokens;
        return { text: "out", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } };
      });
      await adapter.complete({ prompt: "hi" });
      expect(cap).toBe(REASONING_MAX_OUTPUT_TOKENS);
    }
  });

  it("passes the prompt, token cap, and abort signal to generateText and maps the result", async () => {
    const calls: unknown[] = [];
    const adapter = new AiSdkCompletionAdapter("anthropic/claude-sonnet-4-5", fullEnv, async (args) => {
      calls.push(args);
      return { text: "out", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 20 } };
    });
    const controller = new AbortController();
    const result = await adapter.complete({ prompt: "hi", fixtureId: "ignored" }, controller.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ prompt: "hi", maxOutputTokens: 4096, abortSignal: controller.signal });
    expect(result.text).toBe("out");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(result.costUsd).toBeCloseTo((10 * 3 + 20 * 15) / 1_000_000, 12);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
