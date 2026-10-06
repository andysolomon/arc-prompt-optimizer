import type { ModelId } from "@/lib/types";

/**
 * USD per one million tokens. Snapshot of published list prices; update when providers change them.
 * A model that is missing here reports cost as unknown, never as 0.
 */
export const PRICING_USD_PER_MILLION: Readonly<Partial<Record<ModelId, { input: number; output: number }>>> =
  Object.freeze({
    "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
    "anthropic/claude-haiku-4-5": { input: 1, output: 5 },
    "openai/gpt-5-mini": { input: 0.25, output: 2 },
    "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  });

/** Returns undefined whenever the price or either token count is unknown. */
export function estimateCostUsd(
  model: ModelId,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const price = PRICING_USD_PER_MILLION[model];
  if (price === undefined) return undefined;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function isCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
