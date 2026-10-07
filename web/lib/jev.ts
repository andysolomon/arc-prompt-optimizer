import type { JevAnswer, JudgeReport } from "@/lib/types";

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const JEV_INSTRUCTIONS = "How well does the output fulfil the task in the prompt?";
export const JEV_CRITERIA = Object.freeze([
  "Off-task or empty",
  "Addresses the task but incomplete or vague",
  "Complete and accurate, some loose ends",
  "Complete, accurate, and clearly organized",
] as const);

export const JEV_MAX_LEVEL = JEV_CRITERIA.length - 1;

export interface JevEntry {
  readonly candidateId: string;
  readonly prompt: string;
  readonly output: string;
}

/** Maps a Score position on the 0..3 scale to [0, 1]; out-of-range and non-finite values are clamped. */
export function normalizeJevScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score / JEV_MAX_LEVEL));
}

/** Stable question keys: candidate ids may contain characters the API rejects in map keys. */
export function questionKey(index: number): string {
  return `candidate_${index}`;
}

/**
 * One request for every candidate. `state` carries all prompt/output pairs keyed by question key, and each
 * Score question points at its own pair so a single call judges every output.
 */
export function buildJevRequest(entries: readonly JevEntry[]): Record<string, unknown> {
  const state: Record<string, { prompt: string; output: string }> = {};
  const questions: Record<string, unknown> = {};
  entries.forEach((entry, index) => {
    const key = questionKey(index);
    state[key] = { prompt: entry.prompt, output: entry.output };
    questions[key] = {
      type: "score",
      instructions: `${JEV_INSTRUCTIONS} Judge only the prompt and output under state.${key}.`,
      criteria: [...JEV_CRITERIA],
    };
  });
  return { model: JEV_MODEL, state, questions };
}

export class JevResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevResponseError";
  }
}

function numberRecord(value: unknown, label: string): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JevResponseError(`${label} is not an object.`);
  }
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new JevResponseError(`${label}.${key} is not a number.`);
    out[key] = entry;
  }
  return out;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JevResponseError(`${label} is not an object.`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") throw new JevResponseError(`${label}.${key} is not a string.`);
    out[key] = entry;
  }
  return out;
}

/** Validates the TypeSafe response and re-keys answers by candidate id. */
export function parseJevResponse(
  body: unknown,
  entries: readonly JevEntry[],
): { model: string; answers: Record<string, JevAnswer> } {
  if (body === null || typeof body !== "object") throw new JevResponseError("Response body is not an object.");
  const record = body as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model : JEV_MODEL;
  const answers = record.answers;
  if (answers === null || typeof answers !== "object") throw new JevResponseError("Response has no answers.");
  const out: Record<string, JevAnswer> = {};
  entries.forEach((entry, index) => {
    const key = questionKey(index);
    const answer = (answers as Record<string, unknown>)[key];
    if (answer === null || typeof answer !== "object") throw new JevResponseError(`Missing answer for ${key}.`);
    const { score, confidence, probabilities, legend } = answer as Record<string, unknown>;
    if (typeof score !== "number" || !Number.isFinite(score)) throw new JevResponseError(`${key}.score is not a number.`);
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
      throw new JevResponseError(`${key}.confidence is not a number.`);
    }
    out[entry.candidateId] = {
      score,
      confidence,
      probabilities: numberRecord(probabilities, `${key}.probabilities`),
      legend: stringRecord(legend, `${key}.legend`),
      normalized: normalizeJevScore(score),
    };
  });
  return { model, answers: out };
}

export interface JevClientOptions {
  readonly apiKey: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Never throws: a failed judge call degrades to `{ status: "failed", reason }` so the deterministic ranking still ships. */
export async function judgeWithJev(entries: readonly JevEntry[], options: JevClientOptions): Promise<JudgeReport> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("TypeSafe request timed out.")), options.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error("Run cancelled.");
    const response = await doFetch(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildJevRequest(entries)),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: "failed", reason: `TypeSafe responded with HTTP ${response.status}.` };
    }
    const parsed = parseJevResponse(await response.json(), entries);
    return { status: "judged", model: parsed.model, answers: parsed.answers };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "TypeSafe request failed.";
    return { status: "failed", reason };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
