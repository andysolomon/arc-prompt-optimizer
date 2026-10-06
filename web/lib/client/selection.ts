import type { OptimizeResult } from "@/lib/types";

/**
 * Candidate shown first. Normally the top-ranked one; but when the rewrite ties for first place (common without
 * the Jev judge, where every preview candidate scores 1.00 and token count breaks the tie), the rewrite is shown,
 * since it shares rank 1 and token count says nothing about prompt quality.
 */
export function defaultSelectionId(result: OptimizeResult): string | null {
  const top = result.ranking[0];
  if (top === undefined) return null;
  if (result.rewrite.status === "rewritten") {
    const rewriteId = result.rewrite.candidateId;
    const rewrite = result.ranking.find((entry) => entry.candidateId === rewriteId);
    if (rewrite !== undefined && rewrite.rank === top.rank) return rewrite.candidateId;
  }
  return top.candidateId;
}
