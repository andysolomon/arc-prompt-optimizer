import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  ModelsApiStreamOptions,
  TextContent,
} from "@earendil-works/pi-ai";
import { CoreValidationError } from "../core/errors.js";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "../core/types.js";
import {
  CompletionCancelledError,
  MAX_COMPLETION_MODEL_CHARACTERS,
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  normalizeCompletionRequest,
  throwIfCompletionAborted,
  validateCompletionResult,
} from "./completion.js";

/** Narrow Pi completion surface used by the adapter and credential-free fakes. */
export interface PiCompletionClient {
  getModels(): readonly Model<Api>[];
  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage>;
}

export type PiCompletionModelScope = "all" | "available";

export interface PiCompletionAdapterOptions {
  readonly client: PiCompletionClient;
  /** Canonical `provider/modelId`, bare model id, or omitted to use the first scoped model. */
  readonly defaultModel?: string;
}

export class PiCompletionAdapterError extends Error {
  readonly stopReason: string | undefined;

  constructor(message: string, stopReason?: string) {
    super(message);
    this.name = "PiCompletionAdapterError";
    this.stopReason = stopReason;
  }
}

type ModelResolution =
  | { readonly status: "found"; readonly model: Model<Api> }
  | { readonly status: "ambiguous" }
  | { readonly status: "unknown" };

function validateConfiguredModelReference(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      `${label} must be a non-empty string when present.`,
    );
  }
  if (value.length > MAX_COMPLETION_MODEL_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `${label} is ${value.length} characters; limit is ${MAX_COMPLETION_MODEL_CHARACTERS}.`,
    );
  }
  return value;
}

function resolveModelReference(
  modelReference: string,
  availableModels: readonly Model<Api>[],
): ModelResolution {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) return { status: "unknown" };

  const normalizedReference = trimmedReference.toLowerCase();
  const canonicalMatches = availableModels.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedReference,
  );
  if (canonicalMatches.length === 1) return { status: "found", model: canonicalMatches[0]! };
  if (canonicalMatches.length > 1) return { status: "ambiguous" };

  const slashIndex = trimmedReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmedReference.slice(0, slashIndex).trim();
    const modelId = trimmedReference.slice(slashIndex + 1).trim();
    if (provider && modelId) {
      const providerMatches = availableModels.filter(
        (model) =>
          model.provider.toLowerCase() === provider.toLowerCase() &&
          model.id.toLowerCase() === modelId.toLowerCase(),
      );
      if (providerMatches.length === 1) return { status: "found", model: providerMatches[0]! };
      if (providerMatches.length > 1) return { status: "ambiguous" };
    }
  }

  const idMatches = availableModels.filter((model) => model.id.toLowerCase() === normalizedReference);
  if (idMatches.length === 1) return { status: "found", model: idMatches[0]! };
  if (idMatches.length > 1) return { status: "ambiguous" };
  return { status: "unknown" };
}

function resolvePiModel(
  modelReference: string | undefined,
  availableModels: readonly Model<Api>[],
  defaultReference: string | undefined,
): Model<Api> {
  const selectedReference = modelReference ?? defaultReference;
  if (selectedReference === undefined) {
    const fallback = availableModels[0];
    if (!fallback) {
      throw new CoreValidationError(
        "INVALID_EVALUATION",
        "Pi completion adapter has no configured models. Pass request.model or configure a default model.",
      );
    }
    return fallback;
  }

  const resolution = resolveModelReference(selectedReference, availableModels);
  if (resolution.status === "found") return resolution.model;
  if (resolution.status === "ambiguous") {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      `Ambiguous Pi model '${selectedReference}'. Multiple models match; use an explicit provider/modelId reference.`,
    );
  }
  throw new CoreValidationError(
    "INVALID_EVALUATION",
    `Unknown Pi model '${selectedReference}'. Configure the model in Pi or choose one of the available models.`,
  );
}

export function buildPiCompletionContext(prompt: string): Context {
  return {
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };
}

/** Join assistant text blocks without importing pi-ai runtime helpers. */
function extractAssistantText(content: readonly (TextContent | { readonly type: string })[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof (block as TextContent).text === "string") {
      parts.push((block as TextContent).text);
    }
  }
  return parts.join("\n");
}

/**
 * Conservative output-token cap: assume up to one token per UTF-16 code unit so
 * CJK and other non-Latin scripts are not systematically under-budgeted.
 */
export function outputCharacterLimitToMaxTokens(limit: number, model: Model<Api>): number {
  const estimated = limit;
  return Math.min(model.maxTokens, Math.max(1, estimated));
}

function mapResponseModelReference(message: AssistantMessage): string | undefined {
  const responseModel = message.responseModel?.trim();
  if (responseModel) {
    return responseModel.toLowerCase().startsWith(`${message.provider.toLowerCase()}/`)
      ? responseModel
      : `${message.provider}/${responseModel}`;
  }
  if (typeof message.model === "string" && message.model.trim() !== "") {
    return `${message.provider}/${message.model}`;
  }
  return undefined;
}

function mapUsage(message: AssistantMessage): CompletionResult["usage"] {
  const { input, output } = message.usage;
  const usage: { inputTokens?: number; outputTokens?: number } = {};
  if (Number.isSafeInteger(input) && input >= 0) usage.inputTokens = input;
  if (Number.isSafeInteger(output) && output >= 0) usage.outputTokens = output;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined;
  return usage;
}

function mapCostUsd(message: AssistantMessage): number | undefined {
  const total = message.usage.cost?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return undefined;
  return total;
}

export function mapPiAssistantMessage(
  message: AssistantMessage,
  latencyMs: number,
  outputLimit: number,
): CompletionResult {
  if (message.stopReason === "aborted") throw new CompletionCancelledError();
  if (message.stopReason === "error") {
    throw new PiCompletionAdapterError(message.errorMessage ?? "Pi completion failed.", message.stopReason);
  }

  const text = extractAssistantText(message.content);
  const result: Record<string, unknown> = { text };
  const model = mapResponseModelReference(message);
  if (model !== undefined) result.model = model;
  result.finishReason = message.rawStopReason ?? message.stopReason;
  if (Number.isSafeInteger(latencyMs) && latencyMs >= 0) result.latencyMs = latencyMs;

  const usage = mapUsage(message);
  if (usage !== undefined) result.usage = usage;

  const costUsd = mapCostUsd(message);
  if (costUsd !== undefined) result.costUsd = costUsd;

  return validateCompletionResult(result, outputLimit);
}

/** Registry surface of Pi hosts before `ModelRegistry.complete()` existed (e.g. Pi 0.80.x). */
type LegacyModelRegistry = Pick<ModelRegistry, "getAll" | "getAvailable" | "getApiKeyAndHeaders">;

/**
 * Older Pi hosts resolve request auth on the registry and dispatch through the pi-ai compat
 * entrypoint, which the host's extension loader aliases to its own copy.
 */
async function completeWithLegacyRegistry<TApi extends Api>(
  registry: LegacyModelRegistry,
  model: Model<TApi>,
  context: Context,
  streamOptions?: ModelsApiStreamOptions<TApi>,
): Promise<AssistantMessage> {
  const auth = await registry.getApiKeyAndHeaders(model as Model<Api>);
  if (!auth.ok) throw new PiCompletionAdapterError(auth.error, "error");
  const compat = await import("@earendil-works/pi-ai/compat");
  const requestOptions: Record<string, unknown> = { ...streamOptions };
  if (auth.apiKey !== undefined) requestOptions.apiKey = auth.apiKey;
  if (auth.headers !== undefined) requestOptions.headers = auth.headers;
  if (auth.env !== undefined) requestOptions.env = auth.env;
  return await compat.complete(model, context, requestOptions as Parameters<typeof compat.complete>[2]);
}

export function createPiCompletionClientFromRegistry(
  registry: ModelRegistry,
  options?: { readonly modelScope?: PiCompletionModelScope },
): PiCompletionClient {
  const modelScope = options?.modelScope ?? "available";
  const hasComplete = typeof (registry as Partial<ModelRegistry>).complete === "function";
  return {
    getModels: () => (modelScope === "all" ? registry.getAll() : registry.getAvailable()),
    complete: hasComplete
      ? (model, context, streamOptions) => registry.complete(model, context, streamOptions)
      : (model, context, streamOptions) => completeWithLegacyRegistry(registry, model, context, streamOptions),
  };
}

async function awaitCompletionWithAbortPriority(
  completion: Promise<AssistantMessage>,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  throwIfCompletionAborted(signal);
  if (signal === undefined) return completion;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      handler();
    };
    const onAbort = (): void => finish(() => reject(new CompletionCancelledError()));
    signal.addEventListener("abort", onAbort);
    completion.then(
      (message) =>
        finish(() => {
          if (signal.aborted) reject(new CompletionCancelledError());
          else resolve(message);
        }),
      (error: unknown) =>
        finish(() => {
          if (signal.aborted) reject(new CompletionCancelledError());
          else reject(error);
        }),
    );
  });
}

export class PiCompletionAdapter implements CompletionAdapter {
  readonly #client: PiCompletionClient;
  readonly #defaultModel: string | undefined;

  constructor(options: PiCompletionAdapterOptions) {
    if (!options.client || typeof options.client.complete !== "function") {
      throw new TypeError("Pi completion adapter requires a client with getModels() and complete().");
    }
    if (typeof options.client.getModels !== "function") {
      throw new TypeError("Pi completion adapter requires a client with getModels() and complete().");
    }
    this.#client = options.client;
    this.#defaultModel = validateConfiguredModelReference(
      options.defaultModel,
      "Pi completion adapter defaultModel",
    );
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    throwIfCompletionAborted(signal);
    const checkedRequest = normalizeCompletionRequest(request);
    if (checkedRequest.fixtureId !== undefined) {
      throw new CoreValidationError(
        "INVALID_EVALUATION",
        "Pi completion adapter does not accept fixtureId. Use FixtureCompletionAdapter for offline fixtures.",
      );
    }

    const outputLimit = checkedRequest.maxOutputCharacters ?? MAX_COMPLETION_OUTPUT_CHARACTERS;
    const model = resolvePiModel(checkedRequest.model, this.#client.getModels(), this.#defaultModel);
    const context = buildPiCompletionContext(checkedRequest.prompt);
    const startedAt = Date.now();

    const streamOptions: ModelsApiStreamOptions<Api> = {
      maxTokens: outputCharacterLimitToMaxTokens(outputLimit, model),
      cacheRetention: "none",
    };
    if (signal !== undefined) streamOptions.signal = signal;

    const message = await awaitCompletionWithAbortPriority(
      this.#client.complete(model, context, streamOptions),
      signal,
    );

    throwIfCompletionAborted(signal);
    const latencyMs = Date.now() - startedAt;
    return mapPiAssistantMessage(message, latencyMs, outputLimit);
  }
}

export function createPiCompletionAdapter(options: PiCompletionAdapterOptions): PiCompletionAdapter {
  return new PiCompletionAdapter(options);
}
