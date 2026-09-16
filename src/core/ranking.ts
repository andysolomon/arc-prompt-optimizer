import { CoreValidationError } from "./errors.js";
import { expectDenseArray, expectRecord, readOwnField, rejectUnknownKeys } from "./validation.js";
import type {
  CandidateEvaluation,
  Measurement,
  OperationalTieBreaker,
  RankedCandidate,
  RankingObjective,
} from "./types.js";

const TIE_BREAKERS: readonly OperationalTieBreaker[] = Object.freeze(["totalTokens", "latencyMs", "costUsd"]);

/**
 * Default objective: quality is the deterministic weighted score only; judge scores are reported but carry no
 * weight unless the caller opts in. Operational measurements never contribute to quality; they are used only to
 * break exact quality ties, in the listed order, and only when both candidates have a measured value.
 */
export const DEFAULT_RANKING_OBJECTIVE: RankingObjective = Object.freeze({
  deterministicWeight: 1,
  judgeWeight: 0,
  tieBreakers: TIE_BREAKERS,
});

export function validateRankingObjective(value: unknown): RankingObjective {
  if (value === undefined) return DEFAULT_RANKING_OBJECTIVE;
  const objective = expectRecord(value, "INVALID_OBJECTIVE", "Ranking objective");
  rejectUnknownKeys(objective, ["deterministicWeight", "judgeWeight", "tieBreakers"], "INVALID_OBJECTIVE", "Ranking objective");
  const weights: Record<"deterministicWeight" | "judgeWeight", number> = { deterministicWeight: 1, judgeWeight: 0 };
  for (const name of ["deterministicWeight", "judgeWeight"] as const) {
    const weight = readOwnField(objective, name);
    if (weight === undefined) continue;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1_000) {
      throw new CoreValidationError("INVALID_OBJECTIVE", `Ranking objective '${name}' must be a finite number between 0 and 1000.`);
    }
    weights[name] = weight;
  }
  if (weights.deterministicWeight + weights.judgeWeight <= 0) {
    throw new CoreValidationError("INVALID_OBJECTIVE", "Ranking objective weights must sum to a positive number.");
  }
  const tieBreakersValue = readOwnField(objective, "tieBreakers");
  let tieBreakers: readonly OperationalTieBreaker[] = TIE_BREAKERS;
  if (tieBreakersValue !== undefined) {
    const entries = expectDenseArray(tieBreakersValue, "INVALID_OBJECTIVE", "Ranking objective tieBreakers");
    const seen = new Set<string>();
    tieBreakers = Object.freeze(
      entries.map((entry, index) => {
        if (!TIE_BREAKERS.includes(entry as OperationalTieBreaker)) {
          throw new CoreValidationError(
            "INVALID_OBJECTIVE",
            `Ranking objective tieBreakers[${index}] must be one of ${TIE_BREAKERS.join(", ")}.`,
          );
        }
        if (seen.has(entry as string)) {
          throw new CoreValidationError("INVALID_OBJECTIVE", `Ranking objective tieBreaker '${String(entry)}' is duplicated.`);
        }
        seen.add(entry as string);
        return entry as OperationalTieBreaker;
      }),
    );
  }
  return Object.freeze({ ...weights, tieBreakers });
}

/**
 * Combined quality = (d * deterministic + j * judge) / (d + j) over the components with positive weight.
 * Every weighted component must be measured; if one is unknown the combined score is unknown and nothing is
 * imputed as zero.
 */
export function combineQuality(
  deterministic: Measurement,
  judge: Measurement,
  objective: RankingObjective,
): Measurement {
  const parts: { weight: number; value: Measurement; label: string }[] = [];
  if (objective.deterministicWeight > 0) parts.push({ weight: objective.deterministicWeight, value: deterministic, label: "deterministic" });
  if (objective.judgeWeight > 0) parts.push({ weight: objective.judgeWeight, value: judge, label: "judge" });
  const unknown = parts.filter((part) => part.value.status === "unknown");
  if (unknown.length > 0) {
    return Object.freeze({
      status: "unknown",
      reason: unknown.map((part) => `${part.label} score is unknown (${(part.value as { reason: string }).reason})`).join("; "),
    });
  }
  let weighted = 0;
  let total = 0;
  for (const part of parts) {
    if (part.value.status === "measured") {
      weighted += part.weight * part.value.value;
      total += part.weight;
    }
  }
  return Object.freeze({ status: "measured", value: weighted / total });
}

type Row = {
  readonly candidateId: string;
  readonly combined: Measurement;
  readonly deterministic: Measurement;
  readonly judge: Measurement;
  readonly latencyMs: Measurement;
  readonly totalTokens: Measurement;
  readonly costUsd: Measurement;
};

function compareMeasuredDesc(left: Measurement, right: Measurement): number {
  if (left.status === "measured" && right.status === "measured") return right.value - left.value;
  if (left.status === "measured") return -1;
  if (right.status === "measured") return 1;
  return 0;
}

/**
 * Lower is better. A measured value orders before an unknown one so the comparator stays a total order
 * (sorting is independent of input order); an unknown value is never imputed as zero or ranked above a measured one.
 */
function compareMeasuredAsc(left: Measurement, right: Measurement): number {
  if (left.status === "measured" && right.status === "measured") return left.value - right.value;
  if (left.status === "measured") return -1;
  if (right.status === "measured") return 1;
  return 0;
}

function qualityEqual(left: Row, right: Row): boolean {
  return compareMeasuredDesc(left.combined, right.combined) === 0;
}

function tieBreakerUsed(left: Row, right: Row, objective: RankingObjective): OperationalTieBreaker | null {
  for (const breaker of objective.tieBreakers) {
    if (compareMeasuredAsc(left[breaker], right[breaker]) !== 0) return breaker;
  }
  return null;
}

function compareRows(left: Row, right: Row, objective: RankingObjective): number {
  const byCombined = compareMeasuredDesc(left.combined, right.combined);
  if (byCombined !== 0) return byCombined;
  for (const breaker of objective.tieBreakers) {
    const result = compareMeasuredAsc(left[breaker], right[breaker]);
    if (result !== 0) return result;
  }
  return left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0;
}

/**
 * Reproducible ranking. Order: combined quality (desc, unknown last) → operational tie-breakers (asc; measured
 * before unknown) → candidate id (asc). The individual judge score is reported but is never an independent
 * comparator. Candidates with exactly equal combined quality share a competition rank (1, 1, 3) and list each
 * other in `tiedWith`, even if an operational tie-breaker decided their relative order; `tieBrokenBy` names the
 * measurement whose value or availability decided the order relative to the previous entry, or is null.
 */
export function rankCandidates(
  evaluations: readonly CandidateEvaluation[],
  objective?: RankingObjective,
): readonly RankedCandidate[] {
  const checkedObjective = validateRankingObjective(objective);
  const entries = expectDenseArray(evaluations, "INVALID_EVALUATION", "Candidate evaluations");
  const rows: Row[] = entries.map((entry, index) => {
    const evaluation = expectRecord(entry, "INVALID_EVALUATION", `Candidate evaluation at index ${index}`);
    const candidateId = readOwnField(evaluation, "candidateId");
    const aggregate = readOwnField(evaluation, "aggregate");
    if (typeof candidateId !== "string" || aggregate === null || typeof aggregate !== "object") {
      throw new CoreValidationError("INVALID_EVALUATION", `Candidate evaluation at index ${index} is missing candidateId or aggregate.`);
    }
    const measurement = (name: string): Measurement => {
      const value = readOwnField(aggregate, name);
      if (value !== null && typeof value === "object") {
        const status = readOwnField(value, "status");
        const number = readOwnField(value, "value");
        if (status === "measured" && typeof number === "number" && Number.isFinite(number)) return Object.freeze({ status: "measured", value: number });
        const reason = readOwnField(value, "reason");
        if (status === "unknown" && typeof reason === "string") return Object.freeze({ status: "unknown", reason });
      }
      return Object.freeze({ status: "unknown", reason: `aggregate.${name} is missing or malformed` });
    };
    const deterministic = measurement("deterministicScore");
    const judge = measurement("judgeScore");
    return {
      candidateId,
      combined: combineQuality(deterministic, judge, checkedObjective),
      deterministic,
      judge,
      latencyMs: measurement("latencyMs"),
      totalTokens: measurement("totalTokens"),
      costUsd: measurement("costUsd"),
    };
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.candidateId)) throw new CoreValidationError("INVALID_EVALUATION", `Candidate id '${row.candidateId}' is duplicated.`);
    ids.add(row.candidateId);
  }

  const sorted = [...rows].sort((left, right) => compareRows(left, right, checkedObjective));
  const ranked: RankedCandidate[] = [];
  let currentRank = 1;
  for (const [index, row] of sorted.entries()) {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    if (previous !== undefined && !qualityEqual(previous, row)) currentRank = index + 1;
    const tiedWith = sorted.filter((other) => other !== row && qualityEqual(other, row)).map((other) => other.candidateId);
    const tieBrokenBy = previous !== undefined && qualityEqual(previous, row) ? tieBreakerUsed(previous, row, checkedObjective) : null;
    ranked.push(
      Object.freeze({
        rank: currentRank,
        candidateId: row.candidateId,
        quality: Object.freeze({ combined: row.combined, deterministic: row.deterministic, judge: row.judge }),
        operational: Object.freeze({ latencyMs: row.latencyMs, totalTokens: row.totalTokens, costUsd: row.costUsd }),
        tiedWith: Object.freeze(tiedWith),
        tieBrokenBy,
      }),
    );
  }
  return Object.freeze(ranked);
}
