import { candidateCount, type StepEvent } from "@/lib/types";
import { candidateLabel } from "@/lib/format";
import { OPTIMIZE_PATTERNS } from "@/lib/pattern-candidates";

export interface StepItem {
  readonly key: string;
  readonly label: string;
}

export interface StepState {
  readonly steps: readonly StepItem[];
  readonly done: readonly string[];
}

const PLANNED_RUN = "planned-run:";

/**
 * Steps shown before the server reports anything. Run steps are placeholders until the `render` event names
 * the actual candidates, so a failed rewrite never leaves the list misaligned.
 */
export function planSteps(judge: boolean, rewrite: boolean): StepState {
  const runs = ["baseline", ...(rewrite ? ["rewrite"] : []), ...OPTIMIZE_PATTERNS.map((pattern) => candidateLabel(undefined, pattern.name).toLowerCase())];
  return {
    steps: [
      ...(rewrite ? [{ key: "rewrite", label: "Rewrite the prompt" }] : []),
      { key: "render", label: `Render ${candidateCount(rewrite)} candidates` },
      ...runs.map((name) => ({ key: `${PLANNED_RUN}${name}`, label: `Run ${name}` })),
      ...(judge ? [{ key: "judge", label: "Score outputs with Jev" }] : []),
      { key: "rank", label: "Rank candidates" },
    ],
    done: [],
  };
}

/** Marks a server step done; the `render` event also swaps the planned run steps for the rendered candidates. */
export function advanceSteps(state: StepState, event: StepEvent): StepState {
  let steps = state.steps;
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
  }
  const done = state.done.includes(event.step) ? state.done : [...state.done, event.step];
  return { steps, done };
}

export function progressPercent(doneCount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((Math.min(doneCount, total - 1) + 0.5) / total) * 100));
}
