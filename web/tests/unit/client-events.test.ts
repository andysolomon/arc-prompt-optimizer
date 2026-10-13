import { describe, expect, it } from "vitest";
import { clientEventSchema } from "@/lib/client-events";
import { completionTimeoutSeconds, failureAdvice, failureTitle, isRunFailure, RUN_RETENTION_MINUTES } from "@/lib/client/failure";
import { COMPLETION_TIMEOUT_MS, SLOW_COMPLETION_TIMEOUT_MS } from "@/lib/optimize-run";
import { RUN_TTL_MS } from "@/lib/run-store";

describe("clientEventSchema", () => {
  it("accepts a run outcome with its context and nothing else", () => {
    const parsed = clientEventSchema.safeParse({
      event: "run_failed",
      runId: "4d8e609b-d4a5-4305-b096-2a4a55936b4e",
      model: "opencode-go/glm-5.3",
      kind: "timeout",
      message: "The baseline candidate failed: Completion timed out after 120000ms.",
      lastStep: "run:rewrite-309e0e27",
      followedMs: 140_000,
      visibility: "hidden",
      online: true,
      standalone: false,
    });
    expect(parsed.success).toBe(true);
    expect(clientEventSchema.safeParse({ event: "run_failed", prompt: "secret" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ event: "run_failed", prompt: "secret" }).data).not.toHaveProperty("prompt");
  });

  it("rejects unknown events, ids, models, kinds, and oversized messages", () => {
    expect(clientEventSchema.safeParse({ event: "page_view" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ event: "run_lost", runId: "../etc" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ event: "run_lost", model: "acme/model" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ event: "run_failed", kind: "boom" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ event: "run_failed", message: "x".repeat(600) }).success).toBe(false);
  });
});

describe("run failure advice", () => {
  it("mirrors the server's per-completion timeouts and retention", () => {
    expect(completionTimeoutSeconds("opencode-go/glm-5.3") * 1000).toBe(SLOW_COMPLETION_TIMEOUT_MS);
    expect(completionTimeoutSeconds("minimax/MiniMax-M3") * 1000).toBe(SLOW_COMPLETION_TIMEOUT_MS);
    expect(completionTimeoutSeconds("anthropic/claude-haiku-4-5") * 1000).toBe(COMPLETION_TIMEOUT_MS);
    expect(RUN_RETENTION_MINUTES * 60_000).toBe(RUN_TTL_MS);
  });

  it("explains a timeout on a reasoning model with the limit and a faster alternative", () => {
    const failure = { kind: "timeout" as const, message: "The baseline candidate failed: Completion timed out after 120000ms.", model: "opencode-go/glm-5.3", at: 0, runId: "r1" };
    expect(failureTitle(failure)).toBe("The optimization did not finish");
    expect(failureAdvice(failure)).toContain("GLM-5.3 (OpenCode Go) did not answer one completion within the 120 s limit");
    expect(failureAdvice(failure)).toContain("Claude Haiku 4.5");
    expect(failureAdvice({ ...failure, kind: "provider", statusCode: 503 })).toContain("(HTTP 503)");
    expect(failureTitle({ ...failure, kind: "abandoned" })).toBe("A previous optimization was not picked up");
    expect(failureTitle({ ...failure, kind: "rejected", statusCode: 429 })).toBe("The optimization could not start");
  });

  it("only restores a well-formed failure from storage", () => {
    expect(isRunFailure({ kind: "lost", message: "m", model: "openai/gpt-5-mini", at: 1 })).toBe(true);
    expect(isRunFailure({ kind: "lost" })).toBe(false);
    expect(isRunFailure(null)).toBe(false);
  });
});
