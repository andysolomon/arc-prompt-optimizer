import { MAX_PLAN_PATTERNS } from "@/lib/arc-core/core/index.js";
import type { StepEvent } from "@/lib/types";

export interface StepItem {
  readonly key: string;
  readonly label: string;
}

export interface StepState {
  readonly steps: readonly StepItem[];
  readonly done: readonly string[];
  /** Keys of candidate runs whose completion failed; they are done, but not with an output. */
  readonly failed?: readonly string[];
}

const PLANNED_RUN = "planned-run:";

/**
 * Steps shown before the server reports anything. Run steps are placeholders until the `render` event names
 * the actual candidates, so a failed rewrite never leaves the list misaligned. Revision rounds are added as the
 * server reports them, since whether a round happens depends on the scores.
 */
export function planSteps(judge: boolean, rewrite: boolean, refineRounds = 0): StepState {
  const runs = ["baseline", ...(rewrite ? ["rewrite"] : []), `up to ${MAX_PLAN_PATTERNS} pattern variants`];
  return {
    steps: [
      ...(rewrite ? [{ key: "rewrite", label: "Rewrite the prompt and plan the checks" }] : []),
      { key: "render", label: "Render candidates" },
      ...runs.map((name) => ({ key: `${PLANNED_RUN}${name}`, label: `Run ${name}` })),
      ...(judge ? [{ key: "judge", label: "Score outputs with Jev" }] : []),
      ...Array.from({ length: refineRounds }, (_, index) => ({ key: `refine:${index + 1}`, label: `Refine the best candidate, round ${index + 1}` })),
      { key: "rank", label: "Rank candidates" },
    ],
    done: [],
  };
}

function insertBefore(steps: readonly StepItem[], keys: readonly string[], items: readonly StepItem[]): readonly StepItem[] {
  const at = steps.findIndex((step) => keys.includes(step.key));
  const index = at === -1 ? steps.length : at;
  return [...steps.slice(0, index), ...items, ...steps.slice(index)];
}

/**
 * Marks a server step done. The `render` event also swaps the planned run steps for the rendered candidates, and a
 * `revise` event adds that round (and, when it produced a revision, the revision's run) ahead of judging and ranking.
 */
export function advanceSteps(state: StepState, event: StepEvent): StepState {
  let steps = state.steps;
  let key: string = event.step;
  if (event.step === "render" && event.candidateIds !== undefined) {
    const ids = event.candidateIds;
    const labels = event.candidateLabels ?? ids;
    const runs = ids.map((id, index) => ({ key: `run:${id}`, label: `Run ${(labels[index] ?? id).toLowerCase()}` }));
    const firstPlanned = steps.findIndex((step) => step.key.startsWith(PLANNED_RUN));
    const kept = steps
      .filter((step) => !step.key.startsWith(PLANNED_RUN))
      .map((step) => (step.key === "render" ? { key: "render", label: `Render ${ids.length} candidates` } : step));
    const insertAt = firstPlanned === -1 ? kept.length : firstPlanned;
    steps = [...kept.slice(0, insertAt), ...runs, ...kept.slice(insertAt)];
  } else if (event.step === "revise") {
    const round = event.round ?? 0;
    key = `revise:${round}`;
    const items: StepItem[] = [
      { key, label: event.status === "failed" ? `Revise the prompt (round ${round}): failed, keeping the previous version` : `Revise the prompt (round ${round})` },
    ];
    if (event.status !== "failed" && event.candidateId !== undefined) {
      items.push({ key: `run:${event.candidateId}`, label: `Run ${(event.candidateLabel ?? event.candidateId).toLowerCase()}` });
    }
    if (!steps.some((step) => step.key === key)) steps = insertBefore(steps, ["judge", "rank"], items);
  }
  if (event.step.startsWith("refine:") && event.improved !== undefined) {
    steps = steps.map((step) => (step.key === event.step ? { key: step.key, label: `${step.label} (${event.improved ? "improved" : "no gain"})` } : step));
  }
  let failed = state.failed ?? [];
  if (event.step.startsWith("run:") && event.status === "failed") {
    const reason = event.error === undefined ? "failed" : `failed: ${event.error.message}`;
    steps = steps.map((step) => (step.key === key ? { key: step.key, label: `${step.label} (${reason})` } : step));
    if (!failed.includes(key)) failed = [...failed, key];
  }
  const done = state.done.includes(key) ? state.done : [...state.done, key];
  return { steps, done, failed };
}

export function progressPercent(doneCount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((Math.min(doneCount, total - 1) + 0.5) / total) * 100));
}
