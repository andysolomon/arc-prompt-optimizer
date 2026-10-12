import { describe, expect, it } from "vitest";
import { defaultSelectionId } from "@/lib/client/selection";
import type { OptimizeResult, RankedCandidate, RevisionReport } from "@/lib/types";

function ranked(candidateId: string, rank: number): RankedCandidate {
  const m = { status: "measured", value: 1 } as const;
  return { rank, candidateId, quality: { combined: m, deterministic: m, judge: m }, operational: { latencyMs: m, totalTokens: m, costUsd: m }, tiedWith: [], tieBrokenBy: null };
}

const unknown = { status: "unknown", reason: "n/a" } as const;
const measurements = { latencyMs: unknown, inputTokens: unknown, outputTokens: unknown, totalTokens: unknown, costUsd: unknown };

function revision(candidateId: string, round: number): RevisionReport {
  return { status: "revised", round, candidateId, parentCandidateId: "rewrite-1", targeted: ["max_words"], analysis: [], changes: [], measurements, attempts: 1 };
}

function result(ranking: RankedCandidate[], rewriteId: string | null, revisions: RevisionReport[] = []): OptimizeResult {
  return {
    baselineCandidateId: "baseline-1",
    candidates: [],
    evaluations: [],
    ranking,
    judge: { status: "not_requested" },
    rewrite:
      rewriteId === null
        ? { status: "failed", reason: "x", attempts: 2 }
        : { status: "rewritten", candidateId: rewriteId, analysis: [], changes: [], measurements, attempts: 1 },
    plan: { status: "default", reason: "n/a", suiteId: "prompt-optimize-preview", patterns: [] },
    revisions,
    loop: { rounds: revisions.length, stoppedBecause: "not_requested" },
    completionsUsed: 6,
    model: "minimax/MiniMax-M3",
  };
}

describe("defaultSelectionId", () => {
  it("shows the rewrite when it ties for first", () => {
    expect(defaultSelectionId(result([ranked("baseline-1", 1), ranked("c0-critique", 1), ranked("rewrite-1", 1)], "rewrite-1"))).toBe("rewrite-1");
  });

  it("prefers the latest revision over the rewrite among first-place ties", () => {
    const revisions = [revision("rewrite-v2-1", 2), revision("rewrite-v3-1", 3)];
    expect(defaultSelectionId(result([ranked("rewrite-1", 1), ranked("rewrite-v2-1", 1), ranked("rewrite-v3-1", 1)], "rewrite-1", revisions))).toBe("rewrite-v3-1");
    expect(defaultSelectionId(result([ranked("rewrite-1", 1), ranked("rewrite-v2-1", 1), ranked("rewrite-v3-1", 2)], "rewrite-1", revisions))).toBe("rewrite-v2-1");
  });

  it("keeps the top candidate when the rewrite ranks lower or failed", () => {
    expect(defaultSelectionId(result([ranked("c0-critique", 1), ranked("rewrite-1", 2)], "rewrite-1"))).toBe("c0-critique");
    expect(defaultSelectionId(result([ranked("baseline-1", 1), ranked("c0-critique", 1)], null))).toBe("baseline-1");
    expect(defaultSelectionId(result([], null))).toBeNull();
  });
});
