import { CoreValidationError } from "../core/errors.js";
import {
  expectRecord,
  expectString,
  ownPropertyNames,
  readOwnField,
  rejectUnknownKeys,
} from "../core/validation.js";
import type {
  CompletionAdapter,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
} from "../core/types.js";

export type { CompletionAdapter, CompletionRequest, CompletionResult, CompletionUsage } from "../core/types.js";

export type CompletionAdapterErrorCode = "CANCELLED" | "TIMEOUT";

export const COMPLETION_CANCELLED_CODE: CompletionAdapterErrorCode = "CANCELLED";
export const COMPLETION_TIMEOUT_CODE: CompletionAdapterErrorCode = "TIMEOUT";

export class CompletionAdapterError extends Error {
  readonly code: CompletionAdapterErrorCode;

  constructor(code: CompletionAdapterErrorCode, message: string) {
    super(message);
    this.name = "CompletionAdapterError";
    this.code = code;
  }
}

export class CompletionCancelledError extends CompletionAdapterError {
  constructor() {
    super(COMPLETION_CANCELLED_CODE, "Completion cancelled.");
    this.name = "CompletionCancelledError";
  }
}

export class CompletionTimeoutError extends CompletionAdapterError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(COMPLETION_TIMEOUT_CODE, `Completion timed out after ${timeoutMs}ms.`);
    this.name = "CompletionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Alias using the noun form for callers that prefer cancellation terminology. */
export const CompletionCancellationError = CompletionCancelledError;

export interface CompletionTimeoutOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Maximum prompt size accepted by the provider-neutral completion contract. */
export const MAX_COMPLETION_PROMPT_CHARACTERS = 48_000;
/** Maximum output size accepted by the provider-neutral completion contract. */
export const MAX_COMPLETION_OUTPUT_CHARACTERS = 16_384;
/** Maximum model selector/identifier size accepted by the provider-neutral contract. */
export const MAX_COMPLETION_MODEL_CHARACTERS = 256;
export const DEFAULT_COMPLETION_TIMEOUT_MS = 30_000;
/** The largest delay accepted by the platform timer APIs used by this helper. */
export const MAX_COMPLETION_TIMEOUT_MS = 2_147_483_647;

const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set([
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "hasOwnProperty",
  "__lookupGetter__",
  "__lookupSetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "__proto__",
  "toLocaleString",
]);

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { aborted?: unknown }).aborted === "boolean" &&
    typeof (value as { addEventListener?: unknown }).addEventListener === "function" &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener === "function"
  );
}

function defineDataProperty(
  record: Record<string, unknown>,
  name: string,
  value: unknown,
  enumerable = value !== undefined,
): void {
  Object.defineProperty(record, name, {
    configurable: true,
    enumerable,
    value,
    writable: true,
  });
}

function ownDataOnly<T extends Record<string, unknown>>(record: T): T {
  return new Proxy(record, {
    get(target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(target, property);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    },
    has(target, property) {
      return Object.getOwnPropertyDescriptor(target, property) !== undefined;
    },
  });
}

function normalizeKnownFields(
  fields: readonly (readonly [name: string, value: unknown])[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [name, value] of fields) {
    if (value !== undefined) defineDataProperty(normalized, name, value);
  }
  return ownDataOnly(normalized);
}

function expectPlainDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol-keyed fields.`);
  }
  if (prototype === Object.prototype) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (!STANDARD_OBJECT_PROTOTYPE_KEYS.has(key)) {
        throw new TypeError(`${label} must not contain inherited field '${key}'.`);
      }
    }
    if (Object.getOwnPropertySymbols(prototype).length > 0) {
      throw new TypeError(`${label} must not contain inherited symbol-keyed fields.`);
    }
  }
  const ownNames = Object.getOwnPropertyNames(value);
  const ownNameSet = new Set(ownNames);
  for (const key of ownNames) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} field '${key}' must be a data property.`);
    }
  }
  for (const key in value) {
    if (!ownNameSet.has(key)) {
      throw new TypeError(`${label} must not contain inherited field '${key}'.`);
    }
  }
  for (const key of ["signal", "timeoutMs"]) {
    if (!ownNameSet.has(key) && key in value) {
      throw new TypeError(`${label} must not contain inherited field '${key}'.`);
    }
  }
  return value as Record<string, unknown>;
}

function validateTimeoutOptions(value: CompletionTimeoutOptions | undefined): {
  signal: AbortSignal | undefined;
  timeoutMs: number;
} {
  if (value === undefined) return { signal: undefined, timeoutMs: DEFAULT_COMPLETION_TIMEOUT_MS };
  const options = expectPlainDataRecord(value, "Completion timeout options");
  for (const key of Object.getOwnPropertyNames(options)) {
    if (key !== "signal" && key !== "timeoutMs") {
      throw new TypeError(`Completion timeout options contain unknown field '${key}'.`);
    }
  }

  const signal = readOwnField(options, "signal");
  if (signal !== undefined && !isAbortSignal(signal)) {
    throw new TypeError("Completion timeout option 'signal' must be an AbortSignal.");
  }
  const timeoutValue = readOwnField(options, "timeoutMs");
  const timeoutMs = timeoutValue === undefined ? DEFAULT_COMPLETION_TIMEOUT_MS : timeoutValue;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_COMPLETION_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Completion timeout option 'timeoutMs' must be an integer between 0 and ${MAX_COMPLETION_TIMEOUT_MS}.`,
    );
  }
  return { signal: signal as AbortSignal | undefined, timeoutMs };
}

function validateModelSelection(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoreValidationError("INVALID_EVALUATION", `${label} must be a non-empty string when present.`);
  }
  if (value.length > MAX_COMPLETION_MODEL_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `${label} is ${value.length} characters; limit is ${MAX_COMPLETION_MODEL_CHARACTERS}.`,
    );
  }
  return value;
}

function validateMetadata(value: unknown): CompletionResult["metadata"] {
  if (value === undefined) return undefined;
  const metadata = expectRecord(value, "INVALID_EVALUATION", "Completion adapter result metadata");
  const checked: Record<string, string | number | boolean> = {};
  for (const key of ownPropertyNames(metadata, "INVALID_EVALUATION", "Completion adapter result metadata")) {
    const entry = readOwnField(metadata, key);
    if (
      typeof entry !== "string" &&
      typeof entry !== "boolean" &&
      !(typeof entry === "number" && Number.isFinite(entry))
    ) {
      throw new CoreValidationError(
        "INVALID_EVALUATION",
        `Completion adapter result metadata field '${key}' must be a string, finite number, or boolean.`,
      );
    }
    defineDataProperty(checked, key, entry);
  }
  return ownDataOnly(checked);
}

function validateUsage(value: unknown): CompletionUsage | undefined {
  if (value === undefined) return undefined;
  const usage = expectRecord(value, "INVALID_EVALUATION", "Completion adapter result usage");
  rejectUnknownKeys(
    usage,
    ["inputTokens", "outputTokens"],
    "INVALID_EVALUATION",
    "Completion adapter result usage",
  );
  for (const field of ["inputTokens", "outputTokens"] as const) {
    const tokenCount = readOwnField(usage, field);
    if (
      tokenCount !== undefined &&
      (typeof tokenCount !== "number" || !Number.isSafeInteger(tokenCount) || tokenCount < 0)
    ) {
      throw new CoreValidationError(
        "INVALID_EVALUATION",
        `Completion adapter result usage.${field} must be a non-negative safe integer when present.`,
      );
    }
  }
  return normalizeKnownFields([
    ["inputTokens", readOwnField(usage, "inputTokens")],
    ["outputTokens", readOwnField(usage, "outputTokens")],
  ]) as CompletionUsage;
}

interface ValidatedCompletionRequest {
  readonly request: CompletionRequest;
  readonly outputLimit: number;
}

function validateCompletionRequest(request: CompletionRequest): ValidatedCompletionRequest {
  const record = expectRecord(request, "INVALID_EVALUATION", "Completion request");
  rejectUnknownKeys(
    record,
    ["fixtureId", "model", "prompt", "maxOutputCharacters"],
    "INVALID_EVALUATION",
    "Completion request",
  );

  const fixtureId = readOwnField(record, "fixtureId");
  if (fixtureId !== undefined && typeof fixtureId !== "string") {
    throw new CoreValidationError("INVALID_EVALUATION", "Completion request fixtureId must be a string when present.");
  }

  const model = validateModelSelection(readOwnField(record, "model"), "Completion request model");

  const prompt = expectString(readOwnField(record, "prompt"), "INVALID_EVALUATION", "Completion request prompt");
  if (prompt.length > MAX_COMPLETION_PROMPT_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Completion prompt is ${prompt.length} characters; limit is ${MAX_COMPLETION_PROMPT_CHARACTERS}.`,
    );
  }

  const requestedOutputLimit = readOwnField(record, "maxOutputCharacters");
  let outputLimit = MAX_COMPLETION_OUTPUT_CHARACTERS;
  if (
    requestedOutputLimit !== undefined &&
    (typeof requestedOutputLimit !== "number" ||
      !Number.isSafeInteger(requestedOutputLimit) ||
      requestedOutputLimit <= 0)
  ) {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      "Completion request maxOutputCharacters must be a positive safe integer.",
    );
  }
  if (requestedOutputLimit !== undefined && requestedOutputLimit > MAX_COMPLETION_OUTPUT_CHARACTERS) {
    throw new CoreValidationError(
      "OUTPUT_TOO_LARGE",
      `Completion request maxOutputCharacters is ${requestedOutputLimit}; limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}.`,
    );
  }
  if (requestedOutputLimit !== undefined) outputLimit = requestedOutputLimit;
  return {
    request: normalizeKnownFields([
      ["fixtureId", fixtureId],
      ["model", model],
      ["prompt", prompt],
      ["maxOutputCharacters", requestedOutputLimit],
    ]) as unknown as CompletionRequest,
    outputLimit,
  };
}

/** Returns a validated request containing only the provider-neutral own data fields. */
export function normalizeCompletionRequest(request: CompletionRequest): CompletionRequest {
  return validateCompletionRequest(request).request;
}

export function validateCompletionResult(
  result: unknown,
  outputLimit = MAX_COMPLETION_OUTPUT_CHARACTERS,
): CompletionResult {
  if (
    typeof outputLimit !== "number" ||
    !Number.isSafeInteger(outputLimit) ||
    outputLimit <= 0
  ) {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      "Completion result outputLimit must be a positive safe integer.",
    );
  }
  if (outputLimit > MAX_COMPLETION_OUTPUT_CHARACTERS) {
    throw new CoreValidationError(
      "OUTPUT_TOO_LARGE",
      `Completion result outputLimit is ${outputLimit}; limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}.`,
    );
  }
  const record = expectRecord(result, "INVALID_EVALUATION", "Completion adapter result");
  rejectUnknownKeys(
    record,
    ["text", "model", "finishReason", "latencyMs", "metadata", "usage", "costUsd"],
    "INVALID_EVALUATION",
    "Completion adapter result",
  );
  const text = expectString(readOwnField(record, "text"), "INVALID_EVALUATION", "Completion adapter result text");
  if (text.length > outputLimit) {
    throw new CoreValidationError(
      "OUTPUT_TOO_LARGE",
      `Completion output is ${text.length} characters; limit is ${outputLimit}.`,
    );
  }
  const model = validateModelSelection(readOwnField(record, "model"), "Completion adapter result model");

  const finishReason = readOwnField(record, "finishReason");
  if (finishReason !== undefined && typeof finishReason !== "string") {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      "Completion adapter result finishReason must be a string when present.",
    );
  }

  const latencyMs = readOwnField(record, "latencyMs");
  if (
    latencyMs !== undefined &&
    (typeof latencyMs !== "number" || !Number.isSafeInteger(latencyMs) || latencyMs < 0)
  ) {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      "Completion adapter result latencyMs must be a non-negative safe integer when present.",
    );
  }

  const metadata = validateMetadata(readOwnField(record, "metadata"));
  const usage = validateUsage(readOwnField(record, "usage"));

  const costUsd = readOwnField(record, "costUsd");
  if (costUsd !== undefined && (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0)) {
    throw new CoreValidationError(
      "INVALID_EVALUATION",
      "Completion adapter result costUsd must be a finite non-negative number when present.",
    );
  }
  return normalizeKnownFields([
    ["text", text],
    ["model", model],
    ["finishReason", finishReason],
    ["latencyMs", latencyMs],
    ["metadata", metadata],
    ["usage", usage],
    ["costUsd", costUsd],
  ]) as unknown as CompletionResult;
}

function validateAdapter(adapter: CompletionAdapter): void {
  if (adapter === null || typeof adapter !== "object" || typeof (adapter as { complete?: unknown }).complete !== "function") {
    throw new TypeError("Completion adapter must expose a complete(request, signal?) method.");
  }
}

/** Throws the stable cancellation error when a cooperative adapter receives an aborted signal. */
export function throwIfCompletionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompletionCancelledError();
}

/**
 * Runs one completion with a bounded timer and a signal that is aborted by either
 * the caller or the timer. Provider adapters remain responsible for honoring it.
 */
export async function completeWithTimeout(
  adapter: CompletionAdapter,
  request: CompletionRequest,
  options?: CompletionTimeoutOptions,
): Promise<CompletionResult> {
  validateAdapter(adapter);
  const { signal, timeoutMs } = validateTimeoutOptions(options);
  throwIfCompletionAborted(signal);
  const { request: checkedRequest, outputLimit } = validateCompletionRequest(request);

  const controller = new AbortController();
  const lifecycle: { state: "pending" | "cancelled" | "timed_out" | "completed" } = { state: "pending" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectControl: ((error: CompletionAdapterError) => void) | undefined;

  const control = new Promise<never>((_resolve, reject) => {
    rejectControl = reject;
  });

  const cancel = (): void => {
    if (lifecycle.state !== "pending") return;
    lifecycle.state = "cancelled";
    controller.abort();
    rejectControl?.(new CompletionCancelledError());
  };

  const timeout = (): void => {
    if (lifecycle.state !== "pending") return;
    // If cancellation has already been requested but its event has not yet
    // been dispatched, cancellation remains the deterministic outcome.
    if (signal?.aborted) {
      cancel();
      return;
    }
    lifecycle.state = "timed_out";
    controller.abort();
    rejectControl?.(new CompletionTimeoutError(timeoutMs));
  };

  const onAbort = (): void => cancel();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal?.aborted) {
      cancel();
    } else {
      timer = setTimeout(timeout, timeoutMs);
    }

    const completion = Promise.resolve().then(() => {
      if (lifecycle.state === "cancelled") throw new CompletionCancelledError();
      if (lifecycle.state === "timed_out") throw new CompletionTimeoutError(timeoutMs);
      return adapter.complete(checkedRequest, controller.signal);
    });
    const result = await Promise.race([completion, control]);
    lifecycle.state = "completed";
    return validateCompletionResult(result, outputLimit);
  } catch (error) {
    if (lifecycle.state === "timed_out") throw new CompletionTimeoutError(timeoutMs);
    if (lifecycle.state === "cancelled") throw new CompletionCancelledError();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
