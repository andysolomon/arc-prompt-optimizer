import { setTimeout as delay } from "node:timers/promises";
import { MAX_COMPLETION_OUTPUT_CHARACTERS, normalizeCompletionRequest, validateCompletionResult } from "../adapters/completion.js";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "../core/types.js";

export const SIMULATED_MODELS = Object.freeze([
  Object.freeze({ provider: "simulate", id: "balanced", canonical: "simulate/balanced" }),
  Object.freeze({ provider: "simulate", id: "fast", canonical: "simulate/fast" }),
]);

function textForFixture(fixtureId: string | undefined): string {
  switch (fixtureId) {
    case "json-profile":
      return '{"name":"Ada","role":"engineer","summary":"ok"}';
    case "bullet-summary":
      return "- concise\n- accurate";
    case "exact-ok":
      return "ok";
    default:
      return "ok concise accurate safe";
  }
}

export class SimulatedCompletionAdapter implements CompletionAdapter {
  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const checked = normalizeCompletionRequest(request);
    if (checked.fixtureId === "slow" || checked.fixtureId === "timeout") {
      await delay(50, undefined, { signal });
    }
    const text = textForFixture(checked.fixtureId);
    const result = {
      text,
      model: checked.model ?? "simulate/balanced",
      finishReason: "stop",
      latencyMs: checked.fixtureId === "slow" || checked.fixtureId === "timeout" ? 50 : 1,
      usage: {
        inputTokens: Math.max(1, Math.ceil(checked.prompt.length / 4)),
        outputTokens: Math.max(1, Math.ceil(text.length / 4)),
      },
      costUsd: 0,
      metadata: { adapter: "simulate" },
    };
    return validateCompletionResult(result, checked.maxOutputCharacters ?? MAX_COMPLETION_OUTPUT_CHARACTERS);
  }
}
