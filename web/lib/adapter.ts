import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { MAX_COMPLETION_OUTPUT_CHARACTERS } from "@/lib/arc-core/adapters/index.js";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "@/lib/arc-core/core/index.js";
import type { ServerEnv } from "@/lib/env";
import { getModel, type ModelDefinition } from "@/lib/models";
import { estimateCostUsd } from "@/lib/pricing";
import type { ModelId } from "@/lib/types";

/** Rough character-to-token ratio used only to cap generation so outputs fit the core's character limit. */
export const CHARACTERS_PER_TOKEN_ESTIMATE = 4;

export function outputCharacterLimitToMaxTokens(limit: number): number {
  return Math.max(1, Math.ceil(limit / CHARACTERS_PER_TOKEN_ESTIMATE));
}

export function providerApiKey(model: ModelDefinition, env: ServerEnv): string | undefined {
  return env[model.envVar];
}

/** Builds the AI SDK language model for a canonical id. Throws when the provider key is missing. */
export function languageModelFor(id: ModelId, env: ServerEnv): LanguageModel {
  const model = getModel(id);
  const apiKey = providerApiKey(model, env);
  if (apiKey === undefined) throw new Error(`${model.envVar} is not configured.`);
  switch (model.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model.providerModelId);
    case "openai":
      return createOpenAI({ apiKey })(model.providerModelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model.providerModelId);
  }
}

export type GenerateTextFn = (args: {
  model: LanguageModel;
  prompt: string;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}) => Promise<{
  text: string;
  finishReason: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}>;

/** Pure mapping from an AI SDK result to the core's `CompletionResult`; only defined fields are included. */
export function toCompletionResult(args: {
  modelId: ModelId;
  text: string;
  finishReason: string;
  latencyMs: number;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  outputLimit: number;
}): CompletionResult {
  const truncated = args.text.length > args.outputLimit;
  const result: {
    text: string;
    model: string;
    finishReason: string;
    latencyMs: number;
    usage?: { inputTokens?: number; outputTokens?: number };
    costUsd?: number;
  } = {
    text: truncated ? args.text.slice(0, args.outputLimit) : args.text,
    model: args.modelId,
    finishReason: truncated ? "length" : args.finishReason,
    latencyMs: Math.max(0, Math.round(args.latencyMs)),
  };
  const inputTokens = asCount(args.inputTokens);
  const outputTokens = asCount(args.outputTokens);
  if (inputTokens !== undefined || outputTokens !== undefined) {
    result.usage = {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };
  }
  const costUsd = estimateCostUsd(args.modelId, inputTokens, outputTokens);
  if (costUsd !== undefined) result.costUsd = costUsd;
  return result;
}

function asCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** `CompletionAdapter` backed by the Vercel AI SDK. Ignores the offline `fixtureId` hint. */
export class AiSdkCompletionAdapter implements CompletionAdapter {
  readonly #modelId: ModelId;
  readonly #model: LanguageModel;
  readonly #generate: GenerateTextFn;

  constructor(modelId: ModelId, env: ServerEnv, generate: GenerateTextFn = generateText as unknown as GenerateTextFn) {
    this.#modelId = modelId;
    this.#model = languageModelFor(modelId, env);
    this.#generate = generate;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const outputLimit = request.maxOutputCharacters ?? MAX_COMPLETION_OUTPUT_CHARACTERS;
    const started = performance.now();
    const generated = await this.#generate({
      model: this.#model,
      prompt: request.prompt,
      maxOutputTokens: outputCharacterLimitToMaxTokens(outputLimit),
      ...(signal === undefined ? {} : { abortSignal: signal }),
    });
    return toCompletionResult({
      modelId: this.#modelId,
      text: generated.text,
      finishReason: generated.finishReason,
      latencyMs: performance.now() - started,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      outputLimit,
    });
  }
}

/**
 * Test fixture used by the Playwright smoke test (`ARC_MOCK_PROVIDERS=1`). Returns a deterministic,
 * non-empty output per prompt so the run exercises the real core evaluation and ranking.
 */
export class MockCompletionAdapter implements CompletionAdapter {
  readonly #modelId: ModelId;
  #calls = 0;

  constructor(modelId: ModelId) {
    this.#modelId = modelId;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    if (signal?.aborted) throw new Error("Run cancelled.");
    this.#calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const firstLine = request.prompt.split("\n")[0] ?? "";
    const text = `Mock output ${this.#calls} for: ${firstLine.slice(0, 80)}`;
    return toCompletionResult({
      modelId: this.#modelId,
      text,
      finishReason: "stop",
      latencyMs: 150 + this.#calls * 40,
      inputTokens: Math.ceil(request.prompt.length / CHARACTERS_PER_TOKEN_ESTIMATE),
      outputTokens: 40 + this.#calls * 5,
      outputLimit: request.maxOutputCharacters ?? MAX_COMPLETION_OUTPUT_CHARACTERS,
    });
  }
}
