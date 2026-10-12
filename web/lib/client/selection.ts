import type { OptimizeResult } from "@/lib/types";

/**
 * Candidate shown first. Normally the top-ranked one; but when the rewrite lineage ties for first place (common
 * when every candidate passes every check and token count breaks the tie), the latest revision, else the rewrite,
 * is shown, since it shares rank 1 and token count says nothing about prompt quality.
 */
export function defaultSelectionId(result: OptimizeResult): string | null {
  const top = result.ranking[0];
  if (top === undefined) return null;
  const preferred: string[] = [];
  for (const revision of [...result.revisions].reverse()) if (revision.status === "revised") preferred.push(revision.candidateId);
  if (result.rewrite.status === "rewritten") preferred.push(result.rewrite.candidateId);
  for (const id of preferred) {
    const entry = result.ranking.find((candidate) => candidate.candidateId === id);
    if (entry !== undefined && entry.rank === top.rank) return id;
  }
  return top.candidateId;
}
