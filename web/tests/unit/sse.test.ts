import { describe, expect, it } from "vitest";
import { parseSseChunk } from "@/lib/client/sse";
import { advanceSteps, planSteps, progressPercent } from "@/lib/client/steps";

describe("parseSseChunk", () => {
  it("parses complete messages and keeps the partial remainder", () => {
    const { messages, rest } = parseSseChunk('event: render\ndata: {"step":"render"}\n\nevent: run:x\ndata: {"st');
    expect(messages).toEqual([{ event: "render", data: '{"step":"render"}' }]);
    expect(rest).toBe('event: run:x\ndata: {"st');
  });

  it("joins multi-line data and tolerates CRLF", () => {
    const { messages } = parseSseChunk("event: result\r\ndata: {\r\ndata: }\r\n\r\n");
    expect(messages).toEqual([{ event: "result", data: "{\n}" }]);
  });
});

describe("steps", () => {
  it("plans placeholder run steps with or without the rewrite and judge", () => {
    expect(planSteps(true, true).steps.map((s) => s.label)).toEqual([
      "Rewrite the prompt and plan the checks",
      "Render candidates",
      "Run baseline",
      "Run rewrite",
      "Run up to 3 pattern variants",
      "Score outputs with Jev",
      "Rank candidates",
    ]);
    expect(planSteps(false, false).steps.map((s) => s.label)).toEqual(["Render candidates", "Run baseline", "Run up to 3 pattern variants", "Rank candidates"]);
  });

  it("adds revision rounds ahead of judging and ranking as the server reports them", () => {
    let state = planSteps(true, true);
    state = advanceSteps(state, { step: "rewrite", status: "rewritten" });
    state = advanceSteps(state, { step: "render", candidateIds: ["b", "r", "c"], candidateLabels: ["Baseline", "Rewrite", "Critique"] });
    state = advanceSteps(state, { step: "revise", status: "revised", round: 2, candidateId: "r2", candidateLabel: "Rewrite v2" });
    expect(state.steps.map((s) => s.key)).toEqual(["rewrite", "render", "run:b", "run:r", "run:c", "revise:2", "run:r2", "judge", "rank"]);
    expect(state.steps[5]!.label).toBe("Revise the prompt (round 2)");
    expect(state.steps[6]!.label).toBe("Run rewrite v2");
    expect(state.done).toContain("revise:2");
    state = advanceSteps(state, { step: "run:r2" });
    state = advanceSteps(state, { step: "revise", status: "failed", round: 3 });
    expect(state.steps.map((s) => s.key)).toEqual(["rewrite", "render", "run:b", "run:r", "run:c", "revise:2", "run:r2", "revise:3", "judge", "rank"]);
    expect(state.steps[7]!.label).toMatch(/failed/u);
    expect(state.done).toEqual(["rewrite", "render", "revise:2", "run:r2", "revise:3"]);
  });

  it("plans one refine step per round before ranking and labels it with the round's outcome", () => {
    const planned = planSteps(true, true, 2);
    expect(planned.steps.slice(-3).map((s) => s.key)).toEqual(["refine:1", "refine:2", "rank"]);
    expect(planned.steps.at(-2)!.label).toBe("Refine the best candidate, round 2");
    const state = advanceSteps(planned, { step: "refine:1", improved: false });
    expect(state.done).toEqual(["refine:1"]);
    expect(state.steps.find((s) => s.key === "refine:1")!.label).toBe("Refine the best candidate, round 1 (no gain)");
    expect(advanceSteps(state, { step: "refine:2", improved: true }).steps.find((s) => s.key === "refine:2")!.label).toBe("Refine the best candidate, round 2 (improved)");
    expect(planSteps(true, true).steps.some((s) => s.key.startsWith("refine:"))).toBe(false);
  });

  it("replaces planned run steps with the rendered candidates and marks steps done by key", () => {
    let state = planSteps(true, true);
    state = advanceSteps(state, { step: "rewrite", status: "failed" });
    state = advanceSteps(state, {
      step: "render",
      candidateIds: ["b", "c", "d", "s"],
      candidateLabels: ["Baseline", "Critique", "Decomposition", "Structured reasoning"],
    });
    expect(state.steps.map((s) => s.key)).toEqual(["rewrite", "render", "run:b", "run:c", "run:d", "run:s", "judge", "rank"]);
    expect(state.steps[1]!.label).toBe("Render 4 candidates");
    expect(state.steps[5]!.label).toBe("Run structured reasoning");
    state = advanceSteps(state, { step: "run:b" });
    expect(state.done).toEqual(["rewrite", "render", "run:b"]);
  });

  it("advances the progress bar half a step at a time", () => {
    expect(progressPercent(0, 6)).toBe(8);
    expect(progressPercent(3, 6)).toBe(58);
    expect(progressPercent(6, 6)).toBe(92);
  });
});
