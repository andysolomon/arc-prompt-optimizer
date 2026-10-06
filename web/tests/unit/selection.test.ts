import { describe, expect, it } from "vitest";
import { defaultSelectionId } from "@/lib/client/selection";
import type { OptimizeResult, RankedCandidate } from "@/lib/types";

function ranked(candidateId: string, rank: number): RankedCandidate {
  const m = { status: "measured", value: 1 } as const;
  return { rank, candidateId, quality: { combined: m, deterministic: m, judge: m }, operational: { latencyMs: m, totalTokens: m, costUsd: m }, tiedWith: [], tieBrokenBy: null };
}

function result(ranking: RankedCandidate[], rewriteId: string | null): OptimizeResult {
  const unknown = { status: "unknown", reason: "n/a" } as const;
  return {
    baselineCandidateId: "baseline-1",
    candidates: [],
    evaluations: [],
    ranking,
    judge: { status: "not_requested" },
    rewrite:
      rewriteId === null
        ? { status: "failed", reason: "x" }
        : { status: "rewritten", candidateId: rewriteId, analysis: [], changes: [], measurements: { latencyMs: unknown, inputTokens: unknown, outputTokens: unknown, totalTokens: unknown, costUsd: unknown } },
    completionsUsed: 6,
    model: "minimax/MiniMax-M3",
  };
}

describe("defaultSelectionId", () => {
  it("shows the rewrite when it ties for first", () => {
    expect(defaultSelectionId(result([ranked("baseline-1", 1), ranked("c0-critique", 1), ranked("rewrite-1", 1)], "rewrite-1"))).toBe("rewrite-1");
  });

  it("keeps the top candidate when the rewrite ranks lower or failed", () => {
    expect(defaultSelectionId(result([ranked("c0-critique", 1), ranked("rewrite-1", 2)], "rewrite-1"))).toBe("c0-critique");
    expect(defaultSelectionId(result([ranked("baseline-1", 1), ranked("c0-critique", 1)], null))).toBe("baseline-1");
    expect(defaultSelectionId(result([], null))).toBeNull();
  });
});
