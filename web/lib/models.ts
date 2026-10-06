import { MODEL_IDS, type ModelId, type ModelInfo } from "@/lib/types";

export type Provider = ModelInfo["provider"];

export interface ModelDefinition extends ModelInfo {
  /** Model id passed to the provider SDK. */
  readonly providerModelId: string;
  /** Environment variable that must be present for the provider to be offered. */
  readonly envVar: ProviderEnvVar;
}

export type ProviderEnvVar =
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GOOGLE_GENERATIVE_AI_API_KEY"
  | "MINIMAX_API_KEY"
  | "OPENCODE_API_KEY";

/** OpenAI-compatible chat endpoints for providers without a first-party AI SDK package. */
export const OPENAI_COMPATIBLE_BASE_URLS: Readonly<Record<"minimax" | "opencode-go", string>> = Object.freeze({
  minimax: "https://api.minimax.io/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
});

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
  {
    id: "minimax/MiniMax-M3",
    label: "MiniMax M3",
    provider: "minimax",
    providerModelId: "MiniMax-M3",
    envVar: "MINIMAX_API_KEY",
  },
  {
    id: "minimax/MiniMax-M2.7",
    label: "MiniMax M2.7",
    provider: "minimax",
    providerModelId: "MiniMax-M2.7",
    envVar: "MINIMAX_API_KEY",
  },
  {
    id: "opencode-go/deepseek-v4-pro",
    label: "DeepSeek V4 Pro (OpenCode Go)",
    provider: "opencode-go",
    providerModelId: "deepseek-v4-pro",
    envVar: "OPENCODE_API_KEY",
  },
  {
    id: "opencode-go/glm-5.3",
    label: "GLM-5.3 (OpenCode Go)",
    provider: "opencode-go",
    providerModelId: "glm-5.3",
    envVar: "OPENCODE_API_KEY",
  },
  {
    id: "opencode-go/kimi-k2.6",
    label: "Kimi K2.6 (OpenCode Go)",
    provider: "opencode-go",
    providerModelId: "kimi-k2.6",
    envVar: "OPENCODE_API_KEY",
  },
  {
    id: "opencode-go/qwen3.7-plus",
    label: "Qwen3.7 Plus (OpenCode Go)",
    provider: "opencode-go",
    providerModelId: "qwen3.7-plus",
    envVar: "OPENCODE_API_KEY",
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
