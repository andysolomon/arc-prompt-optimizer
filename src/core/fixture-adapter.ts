import { canonicalStringify } from "./canonical.js";
import { CoreValidationError } from "./errors.js";
import {
  MAX_COMPLETION_OUTPUT_CHARACTERS,
  MAX_COMPLETION_MODEL_CHARACTERS,
  MAX_COMPLETION_PROMPT_CHARACTERS,
  throwIfCompletionAborted,
  validateCompletionResult,
} from "../adapters/completion.js";
import {
  expectDenseArray,
  expectRecord,
  expectString,
  ownPropertyNames,
  readOwnField,
  rejectUnknownKeys,
} from "./validation.js";
import type {
  CompletionAdapter,
  CompletionFixtureDefinition,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
} from "./types.js";

export interface CompletionLimits {
  readonly maxPromptCharacters: number;
  readonly maxOutputCharacters: number;
}

interface FixtureCompletionRequest extends CompletionRequest {
  readonly fixtureId: string;
}

export const DEFAULT_COMPLETION_LIMITS: Readonly<CompletionLimits> = Object.freeze({
  maxPromptCharacters: MAX_COMPLETION_PROMPT_CHARACTERS,
  maxOutputCharacters: MAX_COMPLETION_OUTPUT_CHARACTERS,
});

function validatePositiveInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CoreValidationError(
      "INVALID_FIXTURE",
      `${name} must be a positive safe integer.`,
    );
  }
}

function validateLimits(value: unknown): CompletionLimits {
  const limits = expectRecord(value, "INVALID_FIXTURE", "Completion limits");
  rejectUnknownKeys(
    limits,
    ["maxPromptCharacters", "maxOutputCharacters"],
    "INVALID_FIXTURE",
    "Completion limits",
  );
  const maxPromptCharacters = readOwnField(limits, "maxPromptCharacters");
  const maxOutputCharacters = readOwnField(limits, "maxOutputCharacters");
  validatePositiveInteger("maxPromptCharacters", maxPromptCharacters);
  validatePositiveInteger("maxOutputCharacters", maxOutputCharacters);
  if (maxPromptCharacters > MAX_COMPLETION_PROMPT_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `Completion limit 'maxPromptCharacters' is ${maxPromptCharacters}; limit is ${MAX_COMPLETION_PROMPT_CHARACTERS}.`,
    );
  }
  if (maxOutputCharacters > MAX_COMPLETION_OUTPUT_CHARACTERS) {
    throw new CoreValidationError(
      "OUTPUT_TOO_LARGE",
      `Completion limit 'maxOutputCharacters' is ${maxOutputCharacters}; limit is ${MAX_COMPLETION_OUTPUT_CHARACTERS}.`,
    );
  }
  return Object.freeze({
    maxPromptCharacters,
    maxOutputCharacters,
  });
}

function validateModel(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoreValidationError("INVALID_FIXTURE", `${label} must be a non-empty string when present.`);
  }
  if (value.length > MAX_COMPLETION_MODEL_CHARACTERS) {
    throw new CoreValidationError(
      "INPUT_TOO_LARGE",
      `${label} is ${value.length} characters; limit is ${MAX_COMPLETION_MODEL_CHARACTERS}.`,
    );
  }
  return value;
}

function validateMetadata(
  value: unknown,
  fixtureId: string,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (value === undefined) return undefined;
  const metadata = expectRecord(value, "INVALID_FIXTURE", `Completion fixture '${fixtureId}' metadata`);
  const checked: Record<string, string | number | boolean> = {};
  for (const key of ownPropertyNames(
    metadata,
    "INVALID_FIXTURE",
    `Completion fixture '${fixtureId}' metadata`,
  )) {
    const entry = readOwnField(metadata, key);
    if (
      typeof entry !== "string" &&
      typeof entry !== "boolean" &&
      !(typeof entry === "number" && Number.isFinite(entry))
    ) {
      throw new CoreValidationError(
        "INVALID_FIXTURE",
        `Completion fixture '${fixtureId}' metadata field '${key}' must be a string, finite number, or boolean.`,
      );
    }
    Object.defineProperty(checked, key, {
      configurable: true,
      enumerable: true,
      value: entry,
      writable: true,
    });
  }
  return checked;
}

function validateDefinition(value: unknown): CompletionFixtureDefinition {
  const definition = expectRecord(value, "INVALID_FIXTURE", "Completion fixture definition");
  rejectUnknownKeys(
    definition,
    ["id", "text", "model", "finishReason", "latencyMs", "usage", "metadata", "costUsd"],
    "INVALID_FIXTURE",
    "Completion fixture definition",
  );
  const id = expectString(readOwnField(definition, "id"), "INVALID_FIXTURE", "Completion fixture id");
  if (id.trim() === "") {
    throw new CoreValidationError("INVALID_FIXTURE", "Completion fixture id cannot be empty.");
  }
  const text = expectString(
    readOwnField(definition, "text"),
    "INVALID_FIXTURE",
    `Completion fixture '${id}' text`,
  );
  const model = validateModel(readOwnField(definition, "model"), `Completion fixture '${id}' model`);
  const finishReasonValue = readOwnField(definition, "finishReason");
  const finishReason =
    finishReasonValue === undefined
      ? undefined
      : expectString(finishReasonValue, "INVALID_FIXTURE", `Completion fixture '${id}' finishReason`);
  const latencyMs = readOwnField(definition, "latencyMs");
  if (
    latencyMs !== undefined &&
    (!Number.isSafeInteger(latencyMs) || (latencyMs as number) < 0)
  ) {
    throw new CoreValidationError("INVALID_FIXTURE", `Completion fixture '${id}' has invalid latencyMs.`);
  }

  const usageValue = readOwnField(definition, "usage");
  let usage: CompletionUsage | undefined;
  if (usageValue !== undefined) {
    const usageRecord = expectRecord(usageValue, "INVALID_FIXTURE", `Completion fixture '${id}' usage`);
    rejectUnknownKeys(
      usageRecord,
      ["inputTokens", "outputTokens"],
      "INVALID_FIXTURE",
      `Completion fixture '${id}' usage`,
    );
    const inputTokens = readOwnField(usageRecord, "inputTokens");
    const outputTokens = readOwnField(usageRecord, "outputTokens");
    for (const [field, tokenCount] of [
      ["inputTokens", inputTokens],
      ["outputTokens", outputTokens],
    ] as const) {
      if (
        tokenCount !== undefined &&
        (!Number.isSafeInteger(tokenCount) || (tokenCount as number) < 0)
      ) {
        throw new CoreValidationError(
          "INVALID_FIXTURE",
          `Completion fixture '${id}' usage.${field} must be a non-negative safe integer when present.`,
        );
      }
    }
    usage = {
      ...(inputTokens === undefined ? {} : { inputTokens: inputTokens as number }),
      ...(outputTokens === undefined ? {} : { outputTokens: outputTokens as number }),
    };
  }

  const metadata = validateMetadata(readOwnField(definition, "metadata"), id);
  const costUsd = readOwnField(definition, "costUsd");
  if (costUsd !== undefined && (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0)) {
    throw new CoreValidationError(
      "INVALID_FIXTURE",
      `Completion fixture '${id}' costUsd must be a finite non-negative number when present.`,
    );
  }
  return {
    id,
    text,
    ...(model === undefined ? {} : { model }),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(latencyMs === undefined ? {} : { latencyMs: latencyMs as number }),
    ...(usage === undefined ? {} : { usage }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(costUsd === undefined ? {} : { costUsd: costUsd as number }),
  };
}

function validateRequest(value: unknown): FixtureCompletionRequest {
  const request = expectRecord(value, "INVALID_FIXTURE", "Completion request");
  rejectUnknownKeys(
    request,
    ["fixtureId", "model", "prompt", "maxOutputCharacters"],
    "INVALID_FIXTURE",
    "Completion request",
  );
  const fixtureId = expectString(readOwnField(request, "fixtureId"), "INVALID_FIXTURE", "Completion request fixtureId");
  const model = validateModel(readOwnField(request, "model"), "Completion request model");
  const prompt = expectString(
    readOwnField(request, "prompt"),
    "INVALID_FIXTURE",
    "Completion request prompt",
  );
  const maxOutputCharacters = readOwnField(request, "maxOutputCharacters");
  if (maxOutputCharacters !== undefined) {
    validatePositiveInteger("maxOutputCharacters", maxOutputCharacters);
  }
  return {
    fixtureId,
    ...(model === undefined ? {} : { model }),
    prompt,
    ...(maxOutputCharacters === undefined
      ? {}
      : { maxOutputCharacters: maxOutputCharacters as number }),
  };
}

function cloneResult(fixture: CompletionFixtureDefinition): CompletionResult {
  const text = readOwnField(fixture, "text") as string;
  const model = readOwnField(fixture, "model") as string | undefined;
  const finishReason = readOwnField(fixture, "finishReason") as string | undefined;
  const latencyMs = readOwnField(fixture, "latencyMs") as number | undefined;
  const usage = readOwnField(fixture, "usage") as CompletionUsage | undefined;
  const metadata = readOwnField(fixture, "metadata") as Readonly<Record<string, string | number | boolean>> | undefined;
  const costUsd = readOwnField(fixture, "costUsd") as number | undefined;
  return JSON.parse(
    canonicalStringify({
      text,
      ...(model === undefined ? {} : { model }),
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(latencyMs === undefined ? {} : { latencyMs }),
      ...(usage === undefined ? {} : { usage }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(costUsd === undefined ? {} : { costUsd }),
    }),
  ) as CompletionResult;
}

export class FixtureCompletionAdapter implements CompletionAdapter {
  readonly #fixtures: ReadonlyMap<string, CompletionFixtureDefinition>;
  readonly #limits: CompletionLimits;

  constructor(
    definitions: readonly CompletionFixtureDefinition[],
    limits: CompletionLimits = DEFAULT_COMPLETION_LIMITS,
  ) {
    const checkedLimits = validateLimits(limits);
    const checkedDefinitions = expectDenseArray(definitions, "INVALID_FIXTURE", "Completion fixture definitions");
    this.#limits = Object.freeze({ ...checkedLimits });

    const fixtures = new Map<string, CompletionFixtureDefinition>();
    for (const value of checkedDefinitions) {
      const definition = validateDefinition(value);
      if (fixtures.has(definition.id)) {
        throw new CoreValidationError(
          "INVALID_FIXTURE",
          `Completion fixture id '${definition.id}' is duplicated.`,
        );
      }
      if (definition.text.length > this.#limits.maxOutputCharacters) {
        throw new CoreValidationError(
          "OUTPUT_TOO_LARGE",
          `Completion fixture '${definition.id}' is ${definition.text.length} characters; limit is ${this.#limits.maxOutputCharacters}.`,
        );
      }
      const snapshot = JSON.parse(canonicalStringify(definition)) as CompletionFixtureDefinition;
      fixtures.set(definition.id, Object.freeze(snapshot));
    }
    this.#fixtures = fixtures;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    throwIfCompletionAborted(signal);
    const checkedRequest = validateRequest(request);
    if (checkedRequest.prompt.length > this.#limits.maxPromptCharacters) {
      throw new CoreValidationError(
        "INPUT_TOO_LARGE",
        `Completion prompt is ${checkedRequest.prompt.length} characters; limit is ${this.#limits.maxPromptCharacters}.`,
      );
    }
    const fixture = this.#fixtures.get(checkedRequest.fixtureId);
    if (!fixture) {
      throw new CoreValidationError(
        "UNKNOWN_FIXTURE",
        `Unknown completion fixture '${checkedRequest.fixtureId}'. Available fixtures: ${[...this.#fixtures.keys()].sort().join(", ")}.`,
      );
    }

    const requestedOutputLimit = readOwnField(checkedRequest, "maxOutputCharacters");
    const outputLimit = requestedOutputLimit ?? this.#limits.maxOutputCharacters;
    validatePositiveInteger("maxOutputCharacters", outputLimit);
    if (outputLimit > this.#limits.maxOutputCharacters) {
      throw new CoreValidationError(
        "OUTPUT_TOO_LARGE",
        `Requested output limit ${outputLimit} exceeds adapter limit ${this.#limits.maxOutputCharacters}.`,
      );
    }
    if (fixture.text.length > outputLimit) {
      throw new CoreValidationError(
        "OUTPUT_TOO_LARGE",
        `Completion fixture '${fixture.id}' is ${fixture.text.length} characters; request limit is ${outputLimit}.`,
      );
    }

    throwIfCompletionAborted(signal);
    return validateCompletionResult(cloneResult(fixture), outputLimit);
  }
}
