import { MODEL_IDS, type ModelId, type ModelInfo } from "@/lib/types";

export type Provider = ModelInfo["provider"];

export interface ModelDefinition extends ModelInfo {
  /** Model id passed to the provider SDK. */
  readonly providerModelId: string;
  /** Environment variable that must be present for the provider to be offered. */
  readonly envVar: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
}

export const MODELS: readonly ModelDefinition[] = Object.freeze([
  {
    id: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
    providerModelId: "claude-sonnet-4-5",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    providerModelId: "claude-haiku-4-5",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 mini",
    provider: "openai",
    providerModelId: "gpt-5-mini",
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    providerModelId: "gemini-2.5-flash",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
]);

export function isModelId(value: string): value is ModelId {
  return (MODEL_IDS as readonly string[]).includes(value);
}

export function getModel(id: ModelId): ModelDefinition {
  const model = MODELS.find((entry) => entry.id === id);
  if (model === undefined) throw new Error(`Unknown model '${id}'.`);
  return model;
}

export function modelLabel(id: string): string {
  return MODELS.find((entry) => entry.id === id)?.label ?? id;
}

/** Models whose provider key is present. Pure so the filter is unit-testable without `process.env`. */
export function availableModels(env: Readonly<Record<string, string | undefined>>): readonly ModelInfo[] {
  return MODELS.filter((model) => (env[model.envVar] ?? "").trim().length > 0).map(
    ({ id, label, provider }) => ({ id, label, provider }),
  );
}
